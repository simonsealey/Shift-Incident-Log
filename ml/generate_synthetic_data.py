"""
Synthetic data generator for the Shift & Incident Log.

Produces a realistic, *labeled* dataset of shift-log entries for the SUD-rehab
domain so the NLP models (event-type classification, severity scoring, PII
redaction, topic modeling) have enough volume to train and evaluate on.

Design goals
------------
* Reproducible            - single RNG seed.
* Realistic & imbalanced  - class frequencies mirror a real log (lots of
                            Behavioral / Incident / Medical, fewer Visitor /
                            Maintenance / Other), so we can demonstrate
                            class-imbalance handling.
* Genuinely confusable    - templates deliberately share vocabulary across
                            classes (e.g. a wall-punch is Incident *and*
                            Behavioral *and* Maintenance), and a fraction of
                            narratives are terse, so the classifier faces real
                            ambiguity and the confusion matrix is meaningful.
* Self-consistent metadata- shift is derived from time, follow-up/resolution
                            follow sensible logic, dates span ~6 months.
* Privacy targets         - a subset of narratives have realistic PII woven in
                            (full names, phones, dates, addresses) for the
                            redaction step; the injected spans are recorded in
                            `pii_terms` so that step can be evaluated.

Output: ml/data/shift_log_synthetic.csv
Usage : python ml/generate_synthetic_data.py [N]
"""

import csv
import os
import random
import re
import sys
from datetime import date, datetime, timedelta

SEED = 42
DEFAULT_N = 900
OUT_PATH = os.path.join(os.path.dirname(__file__), "data", "shift_log_synthetic.csv")

# Window ends on the project's "today" and runs back ~6 months.
END_DATE = date(2026, 6, 19)
START_DATE = END_DATE - timedelta(days=180)

CAMPUSES = (["Main Campus"] * 50 + ["Phoenix Concept"] * 28 + ["Stepping Stone"] * 22)

# Imbalanced on purpose.
EVENT_WEIGHTS = {
    "Behavioral":  27,
    "Incident":    24,
    "Medications": 20,   # med pass / refusals / counts — very common in SUD rehab
    "Medical":     14,   # health events (vitals, injuries, emergencies)
    "Maintenance": 11,
    "Visitor":     10,
    "Other":        8,
}

STAFF = [
    "Simon Sealey", "Aisha Johnson", "Mike O'Brien", "Carlos Rivera",
    "Dana Whitfield", "Priya Nair", "Marcus Bell", "Elena Petrova",
    "Tyrone Walker", "Sofia Mendez", "Grace Kim", "Nathan Brooks",
]

# Names used only as PII *inside* narratives (family members, peers, officials).
PII_NAMES = [
    "Robert Hayes", "Linda Carter", "James Whitman", "Maria Gonzalez",
    "Kevin Doyle", "Angela Foster", "Brian Sullivan", "Teresa Lin",
    "Officer Daniels", "Dr. Patel", "Sandra Mills", "Derek Thompson",
]
STREETS = ["Maple Ave", "4th St", "Cactus Rd", "Willow Ln", "Sunrise Blvd", "Pine St"]

# ── Slot vocabularies ────────────────────────────────────────────────────────
AREAS = ["the common room", "the dayroom", "the kitchen", "the courtyard",
         "the hallway", "the parking lot", "the group room", "the laundry room",
         "the front entrance", "the rec area"]
GROUPS = ["process group", "CBT group", "relapse-prevention group",
          "morning check-in", "community meeting", "skills group"]
CONTRABAND = ["an unauthorized vape device", "a phone charger not on the approved list",
              "prescription pills not in the med log", "a small amount of a suspected substance",
              "an unapproved lighter", "an unlabeled bottle"]
SUBSTANCES = ["a controlled substance", "alcohol", "an unidentified substance"]
ITEMS = ["a pair of headphones", "their wallet", "a hoodie", "a phone charger", "cash"]
HOSPITALS = ["Banner Desert", "Valleywise Health", "the local ED", "HonorHealth"]
APPTS = ["medical", "dental", "court", "outpatient", "DMV"]
BODYPARTS = ["forearm", "hand", "shin", "forehead", "ankle"]
VENDORS = ["Desert HVAC Services", "QuickFix Plumbing", "Sysco Foods",
           "Cintas", "the pharmacy courier", "ABC Pest Control"]
OFFICIALS = ["a probation officer", "a case manager from the county",
             "a state licensing inspector", "an attorney"]

# ── Scenario banks ───────────────────────────────────────────────────────────
# Each scenario: (severity, followup_prob, [templates], [followup_notes])
SCENARIOS = {
    "Incident": [
        ("High", 0.85, [
            "Routine room check of {room} found {contraband}. Item confiscated and logged in the contraband bin; client notified and an incident report filed.",
            "Client {client} was found with {contraband} during a search. Confiscated per policy and documented.",
        ], ["Clinical team to review in treatment plan.", "Director notified; report on file."]),
        ("High", 0.9, [
            "Client {client} left the property without authorization and did not return for the {time} check. On-call clinician and program director notified per AWOL protocol.",
            "{client} eloped from {area} during the {shift} shift. Searched the grounds and initiated the AWOL procedure.",
        ], ["AWOL protocol active; awaiting return.", "Notify clinician on return; safety plan needed."]),
        ("Medium", 0.4, [
            "Client {client} missed the {time} curfew by {n} minutes, returning at {time2}. Met with the shift lead and reviewed expectations; verbal redirection given.",
            "{client} returned late from an approved outing at {time2}. Reviewed curfew policy and documented.",
        ], ["Shift lead to follow up on pattern.", "Monitor curfew compliance this week."]),
        ("Medium", 0.55, [
            "Client {client} punched the wall in {area} during a disagreement, leaving a dent. No injuries. Maintenance notified and incident documented.",
            "Property damage in {area}: a chair was thrown and broken during a dispute. No one hurt; report filed.",
        ], ["Maintenance to repair; counselor to address behavior.", "Damage logged; restitution discussion pending."]),
        ("Medium", 0.5, [
            "Client {client} reported {item} missing from their room. Took a statement, searched common areas, and filed a report.",
            "Suspected theft reported in {area}: {item} went missing. Statements taken and documented.",
        ], ["Follow up with both clients involved.", "Review camera coverage in the area."]),
        ("Low", 0.2, [
            "Exterior door near {area} found propped open during the {shift} round. Secured it and reminded clients about the door policy.",
            "Perimeter check found a gate unlatched by {area}. Secured and noted for the next round.",
        ], ["Remind all clients at community meeting.", "Check door sensor with maintenance."]),
    ],
    "Medical": [
        ("High", 0.9, [
            "Client {client} reported nausea, sweating, and tremors consistent with withdrawal. Vitals taken (BP {bp}, HR {hr}); nurse monitoring on the detox protocol.",
            "{client} showing escalating withdrawal symptoms overnight. Nurse notified; placed on closer monitoring.",
        ], ["Nurse to reassess each shift.", "Clinician to review detox orders."]),
        ("High", 0.95, [
            "Found client {client} unresponsive in {area}. Administered Narcan, called 911, and the client was transported to {hospital}. Family contacted.",
            "Client {client} had a seizure in {area}. 911 called and EMS transported to {hospital}. Incident documented.",
        ], ["Await hospital update; notify clinician.", "Debrief staff and update care plan."]),
        ("Medium", 0.5, [
            "Client {client} sustained a minor laceration to the {bodypart} in {area}. First aid administered; no further treatment needed.",
            "{client} reported {bodypart} pain after a fall in {area}. Assessed, iced, and monitored; no transport required.",
        ], ["Recheck the injury next shift.", "Notify nurse if swelling increases."]),
        ("Low", 0.15, [
            "Completed routine vitals for client {client}: BP {bp}, HR {hr}, temp {temp}. Within normal limits.",
            "Weekly weight and vitals recorded for {client}; all within range.",
        ], ["", "Routine; no action needed."]),
        ("Medium", 0.6, [
            "Client {client} reported chest tightness and shortness of breath. Vitals stable; nurse assessed and is monitoring closely.",
            "{client} complained of severe headache and dizziness. Vitals elevated (BP {bp}); nurse notified and monitoring.",
        ], ["Nurse to reassess in one hour.", "Physician notified; document any changes."]),
    ],
    "Medications": [
        ("Low", 0.08, [
            "Completed the {time} medication pass for the unit. All clients received scheduled meds; no refusals. MAR signed and counts verified.",
            "Administered scheduled medications at {time}; all counts correct and the MAR was signed.",
        ], ["", ""]),
        ("Medium", 0.75, [
            "Client {client} refused all scheduled medications. Refusal documented in the MAR; on-call nurse and clinician notified.",
            "{client} declined evening meds again, citing side effects. Documented refusal in the MAR; nurse notified to follow up.",
        ], ["Clinician to discuss medication adherence.", "Nurse to review refusal pattern at next shift."]),
        ("Low", 0.15, [
            "Completed pill counts at {time}; all medications accounted for. No discrepancies noted in the controlled-substance log.",
            "End-of-shift medication inventory conducted. All controlled substance counts match the log.",
        ], ["", ""]),
        ("Medium", 0.4, [
            "Client {client} had difficulty swallowing tablets and required extra assistance at the {time} pass. Documented and nurse notified.",
            "Medication administered late to {client} due to the client being off-unit at the scheduled time. Dose given at {time2}; documented.",
        ], ["Nurse to review administration plan.", ""]),
        ("High", 0.9, [
            "Medication error at the {time} pass: client {client} was given the wrong dosage. Nurse notified immediately and incident report filed per protocol.",
            "Wrong medication administered to {client} during the {time} pass. Nurse and program director notified; pharmacy contacted. Incident documented.",
        ], ["Nurse and physician must review. File incident report.", "Pharmacy and director to be notified; client monitored."]),
        ("Low", 0.2, [
            "New prescription received for {client} from the prescriber. Medication logged in the MAR and will be filled at the next pharmacy run.",
            "Client {client} received an updated prescription order; medication list updated and nursing informed.",
        ], ["Confirm fill before next scheduled pass.", ""]),
    ],
    "Behavioral": [
        ("Medium", 0.45, [
            "Clients {client} and {client2} got into a verbal altercation in {area}. Staff separated them, used de-escalation, and processed the conflict individually.",
            "Verbal dispute between {client} and a peer in {area}. Interventions used; both returned to baseline.",
        ], ["Counselors to schedule a mediation.", "Monitor the two clients this shift."]),
        ("Medium", 0.35, [
            "Client {client} became agitated and raised their voice at staff after being redirected. De-escalated with a one-on-one; client returned to baseline.",
            "{client} escalated during {group} and left the room upset. Followed up one-on-one and processed the trigger.",
        ], ["Counselor to check in tomorrow.", "Note triggers for the care team."]),
        ("High", 0.85, [
            "Client {client} made a verbal threat toward a peer during {group}. Removed from the group, met with the shift lead, and reviewed the safety plan.",
            "{client} threatened another resident in {area}. Separated the clients and notified the clinician.",
        ], ["Clinician to update safety plan.", "Increase checks; notify next shift."]),
        ("High", 0.9, [
            "Client {client} disclosed thoughts of self-harm to staff. Clinician notified immediately and one-to-one observation initiated per protocol.",
            "{client} expressed hopelessness and passive SI during check-in. Placed on close observation and alerted the on-call clinician.",
        ], ["Maintain 1:1; clinician to assess.", "Continue close observation next shift."]),
        ("Low", 0.2, [
            "Client {client} declined to attend {group} and stayed in their room. Encouraged participation and notified the counselor.",
            "{client} was withdrawn today and skipped {group}. Checked in and documented.",
        ], ["Counselor to follow up on engagement.", ""]),
        ("Low", 0.3, [
            "Client {client} was found in an unauthorized area with a peer. Redirected and reviewed program boundaries.",
            "Reminded {client} about phone-use boundaries after a minor rule violation in {area}.",
        ], ["Review boundaries at community meeting.", ""]),
    ],
    "Maintenance": [
        ("Medium", 0.6, [
            "Clients reporting the swamp cooler in {room} is not working. Contacted maintenance; temporary fans provided.",
            "HVAC out in {area}; room temperature climbing. Submitted an urgent maintenance request.",
        ], ["Maintenance to repair tomorrow AM.", "Follow up if not fixed by next shift."]),
        ("Medium", 0.6, [
            "Water leak under the sink in {area}. Shut off the supply valve and submitted a maintenance request.",
            "Plumbing backup in {area}; placed it out of service and notified facilities.",
        ], ["Plumber scheduled; check status.", "Confirm repair completed."]),
        ("Low", 0.4, [
            "The lock on the {area} door is sticking and won't latch. Reported to facilities; using the secondary entrance for now.",
            "Broken handle on the {area} door. Maintenance ticket submitted.",
        ], ["Verify lock repaired for security.", ""]),
        ("Low", 0.25, [
            "Overhead light out in {area}. Maintenance ticket submitted.",
            "Flickering lights in {area} reported; logged a facilities request.",
        ], ["", ""]),
        ("Low", 0.3, [
            "Dryer in the laundry room stopped mid-cycle and won't restart. Out-of-service sign posted; maintenance notified.",
            "Refrigerator in {area} not cooling properly. Moved perishables and reported it.",
        ], ["Appliance repair pending.", ""]),
    ],
    "Visitor": [
        ("Low", 0.1, [
            "A visitor checked in for an approved family visit with client {client}. ID verified, visit logged, and supervised in the visitation room.",
            "Approved visit for {client} today; visitor signed in and out without issue.",
        ], ["", ""]),
        ("Low", 0.2, [
            "{vendor} arrived for scheduled service. Verified the work order, escorted them on site, and signed them out at {time2}.",
            "{vendor} on site for a delivery to the front office at {time}. Logged and stored.",
        ], ["", ""]),
        ("Low", 0.1, [
            "Prospective client and family toured {campus} with the admissions coordinator.",
            "Gave a scheduled facility tour to a referral source for {campus}.",
        ], ["", ""]),
        ("Medium", 0.5, [
            "{official} arrived to meet with client {client}. Verified credentials and documented the visit.",
            "{official} requested a meeting regarding {client}. Confirmed authorization and supervised the visit.",
        ], ["File visit documentation.", "Notify case manager of the visit."]),
        ("Medium", 0.55, [
            "An unscheduled visitor requested to see a client. No approval was on file, so entry was declined and they were asked to contact the clinician.",
            "Unauthorized visitor at the gate asking for a resident. Turned away per policy and documented.",
        ], ["Clinician to address with the client.", "Add to visitor watch list."]),
    ],
    "Other": [
        ("Low", 0.05, [
            "Completed the {time} headcount; all {n} clients accounted for.",
            "End-of-shift census check at {time}: {n} clients present, none off-site.",
        ], ["", ""]),
        ("Low", 0.1, [
            "Conducted a fire drill at {time}; the building was evacuated in {n} minutes and all clients were accounted for.",
            "Monthly safety drill completed at {time}. Documented evacuation time and attendance.",
        ], ["", ""]),
        ("Low", 0.15, [
            "Transported {n} clients to an offsite {appt} appointment. All returned by {time2}.",
            "Accompanied a client to a scheduled {appt} appointment; returned without issue.",
        ], ["", ""]),
        ("Low", 0.1, [
            "Quiet {shift} shift. No incidents to report; passed open items on to the next shift.",
            "Uneventful {shift} shift. Routine checks completed and logged.",
        ], ["", ""]),
        ("Low", 0.2, [
            "New client admitted to {campus} and oriented to the unit. Belongings searched per policy.",
            "Processed a new admission on the {shift} shift; completed orientation and intake checklist.",
        ], ["Assign a primary counselor.", ""]),
    ],
}

# Second-sentence add-ons to vary narrative length (kept class-neutral).
ADDONS = [
    " Client was cooperative throughout.", " No injuries reported.",
    " Next shift advised.", " Documented in the client's chart.",
    " Will continue to monitor.", " Area returned to normal.",
    "", "", "",  # often no add-on
]


def weighted_events(rng, n):
    pool = []
    for ev, w in EVENT_WEIGHTS.items():
        pool += [ev] * w
    return [rng.choice(pool) for _ in range(n)]


def time_for_shift_pref(rng):
    """Pick a realistic clock time; spread across the 24h day."""
    h = rng.randint(0, 23)
    m = rng.choice([0, 5, 10, 15, 20, 30, 35, 40, 45, 50, 55])
    return h, m


def shift_for_time(h, m):
    mins = h * 60 + m
    if 330 <= mins < 870:
        return "Day"
    if 870 <= mins < 1350:
        return "Evening"
    return "Overnight"


def fmt12(h, m):
    suffix = "AM" if h < 12 else "PM"
    hh = h % 12
    if hh == 0:
        hh = 12
    return f"{hh}:{m:02d} {suffix}"


def client_ref(rng):
    """Anonymized client identifier (initials only) so narratives stay de-identified
    and read cleanly after any 'client'/'Client'/'Clients' wording in a template."""
    L = "ABCDEFGHJKLMNPRSTW"
    if rng.random() < 0.65:
        return f"{rng.choice(L)}.{rng.choice(L)}."  # e.g. "J.M."
    return f"{rng.choice(L)}."                       # e.g. "R."


def build_context(rng, campus, h, m, shift):
    h2, m2 = time_for_shift_pref(rng)
    return {
        "client": client_ref(rng),
        "client2": client_ref(rng),
        "room": f"Room {rng.randint(100, 130)}",
        "time": fmt12(h, m),
        "time2": fmt12(h2, m2),
        "shift": shift.lower(),
        "campus": campus,
        "area": rng.choice(AREAS),
        "group": rng.choice(GROUPS),
        "contraband": rng.choice(CONTRABAND),
        "substance": rng.choice(SUBSTANCES),
        "item": rng.choice(ITEMS),
        "hospital": rng.choice(HOSPITALS),
        "appt": rng.choice(APPTS),
        "bodypart": rng.choice(BODYPARTS),
        "bp": f"{rng.randint(105,150)}/{rng.randint(65,95)}",
        "hr": rng.randint(58, 110),
        "temp": f"{rng.choice([97.6,98.1,98.4,98.6,99.0,99.4])}",
        "n": rng.randint(2, 24),
        "vendor": rng.choice(VENDORS),
        "official": rng.choice(OFFICIALS),
    }


def clean(s):
    """Tidy slot-filling artifacts (double periods from initials, 'the the')
    and capitalize the sentence."""
    s = re.sub(r"\.{2,}", ".", s)        # "H.F.." -> "H.F."
    s = re.sub(r"\bthe the\b", "the", s)
    s = re.sub(r"\s{2,}", " ", s).strip()
    return s[0].upper() + s[1:] if s else s


def inject_pii(rng, narrative):
    """Weave realistic PII into a narrative and return (text, [pii_terms])."""
    terms = []
    choices = rng.sample(["name", "phone", "date", "address"],
                         k=rng.randint(1, 2))
    extra = []
    if "name" in choices:
        nm = rng.choice(PII_NAMES)
        terms.append(nm)
        extra.append(f"Spoke with {nm} about the situation.")
    if "phone" in choices:
        ph = f"480-555-{rng.randint(1000,9999)}"
        terms.append(ph)
        extra.append(f"Contact number on file is {ph}.")
    if "date" in choices:
        d = (START_DATE + timedelta(days=rng.randint(0, 200)))
        ds = d.strftime("%B %d, %Y")
        terms.append(ds)
        extra.append(f"Follow-up scheduled for {ds}.")
    if "address" in choices:
        addr = f"{rng.randint(100,9999)} {rng.choice(STREETS)}"
        terms.append(addr)
        extra.append(f"Client's listed address is {addr}.")
    return narrative + " " + " ".join(extra), terms


def generate(n, seed=SEED):
    rng = random.Random(seed)
    events = weighted_events(rng, n)
    rows = []
    span_days = (END_DATE - START_DATE).days

    for ev in events:
        sev, fu_prob, templates, notes = rng.choice(SCENARIOS[ev])
        d = START_DATE + timedelta(days=rng.randint(0, span_days))
        h, m = time_for_shift_pref(rng)
        shift = shift_for_time(h, m)
        campus = rng.choice(CAMPUSES)
        staff = rng.choice(STAFF)
        ctx = build_context(rng, campus, h, m, shift)

        narrative = rng.choice(templates).format(**ctx)
        # ~22% terse (drop to first sentence) -> harder cases; else maybe add a clause.
        if rng.random() < 0.22:
            # Split only on periods after lowercase/digit so abbreviation
            # periods (P.M., initials like "J.M.") are not mistaken for
            # sentence boundaries.
            first = re.split(r"(?<=[a-z0-9])\.\s", narrative)[0]
            narrative = first.rstrip(".") + "."
        else:
            narrative += rng.choice(ADDONS)

        pii_terms = []
        if rng.random() < 0.18:
            narrative, pii_terms = inject_pii(rng, narrative)

        narrative = clean(narrative)

        follow_up = "Yes" if rng.random() < fu_prob else "No"
        fu_note = rng.choice(notes) if follow_up == "Yes" else ""

        created = datetime(d.year, d.month, d.day, h, m)
        resolved = False
        resolved_by = resolved_at = resolution_notes = ""
        if follow_up == "Yes":
            # Older open items more likely to be resolved by now.
            age = (END_DATE - d).days
            if rng.random() < min(0.85, 0.25 + age / 220):
                resolved = True
                resolved_by = rng.choice(STAFF)
                rdt = created + timedelta(hours=rng.randint(2, 96))
                resolved_at = rdt.isoformat()
                resolution_notes = rng.choice([
                    "Addressed with the client; resolved.",
                    "Completed the follow-up and closed out.",
                    "Reviewed with the care team; no further action.",
                    "Repair completed and verified.",
                ])

        rows.append({
            "date": d.isoformat(),
            "shift": shift,
            "time": f"{h:02d}:{m:02d}",
            "staff_name": staff,
            "campus": campus,
            "event_type": ev,
            "narrative": narrative,
            "follow_up_needed": follow_up,
            "follow_up_notes": fu_note,
            "resolved": resolved,
            "resolved_by": resolved_by,
            "resolved_at": resolved_at,
            "resolution_notes": resolution_notes,
            "severity": sev,
            "created_at": created.isoformat(),
            "pii_terms": "|".join(pii_terms),
        })

    # ── Label noise ───────────────────────────────────────────────────────────
    # Real staff sometimes logs an event under the wrong category (e.g. a
    # medication refusal could reasonably be Medical or Behavioral; a
    # client altercation could be Incident or Behavioral).  We simulate
    # ~10 % annotation noise at those natural class boundaries so the
    # evaluation metrics reflect a realistic, non-trivial task.
    CONFUSION_MAP = {
        "Incident":    "Behavioral",
        "Behavioral":  "Incident",
        "Medical":     "Behavioral",
        "Medications": "Medical",   # refusal entries sometimes logged as Medical
    }
    NOISE_RATE = 0.10
    noisy_count = 0
    for row in rows:
        if row["event_type"] in CONFUSION_MAP and rng.random() < NOISE_RATE:
            row["event_type"] = CONFUSION_MAP[row["event_type"]]
            row["label_noisy"] = True
            noisy_count += 1
        else:
            row["label_noisy"] = False

    rng.shuffle(rows)
    print(f"  Label noise applied: {noisy_count} rows ({noisy_count/len(rows):.1%})")
    return rows


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_N
    rows = generate(n)
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    fields = list(rows[0].keys())
    with open(OUT_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)

    # Console summary.
    from collections import Counter
    ev_c = Counter(r["event_type"] for r in rows)
    sev_c = Counter(r["severity"] for r in rows)
    camp_c = Counter(r["campus"] for r in rows)
    fu = sum(r["follow_up_needed"] == "Yes" for r in rows)
    res = sum(r["resolved"] for r in rows)
    pii = sum(bool(r["pii_terms"]) for r in rows)
    avg_len = sum(len(r["narrative"].split()) for r in rows) / len(rows)

    print(f"Wrote {len(rows)} rows -> {OUT_PATH}\n")
    print("Event type:", dict(sorted(ev_c.items(), key=lambda x: -x[1])))
    print("Severity  :", dict(sev_c))
    print("Campus    :", dict(camp_c))
    print(f"Follow-up needed: {fu} ({fu/len(rows):.0%}) | resolved: {res} | with PII: {pii}")
    print(f"Avg narrative length: {avg_len:.1f} words")


if __name__ == "__main__":
    main()
