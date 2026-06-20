"""FastAPI ML service for the Shift Log app.

Serves three models:
  • severity_classifier  — predicts Low / Medium / High severity
  • event_type_classifier — suggests the most likely event type from the narrative
  • anomaly_detector      — flags narratives that are unusual vs the training corpus

Run from the ml/ directory:
    uvicorn api:app --reload --host 0.0.0.0 --port 8000

Then visit http://localhost:8000/docs for the interactive API explorer.
"""
from __future__ import annotations

import os
import re
from typing import List, Union

import numpy as np
import pandas as pd
import joblib

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── Paths ──────────────────────────────────────────────────────────────────────
HERE = os.path.dirname(os.path.abspath(__file__))
ART  = os.path.join(HERE, "artifacts")


# ── Load models at startup ────────────────────────────────────────────────────
print("Loading models…")
severity_clf  = joblib.load(os.path.join(ART, "severity_classifier.joblib"))
event_clf     = joblib.load(os.path.join(ART, "event_type_classifier.joblib"))
anomaly_vec   = joblib.load(os.path.join(ART, "anomaly_vectorizer.joblib"))
anomaly_det   = joblib.load(os.path.join(ART, "anomaly_detector.joblib"))
print("All models loaded.")


# ── Text pre-processing (mirrors the training notebooks) ─────────────────────
def preprocess(t: str) -> str:
    t = str(t).lower()
    t = re.sub(r"[^a-z0-9\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


# ── App + CORS ────────────────────────────────────────────────────────────────
app = FastAPI(title="Shift Log ML API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],      # tighten to your domain in production
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Schemas ───────────────────────────────────────────────────────────────────
class PredictRequest(BaseModel):
    narrative: str
    event_type: str = "Other"


class AnomalyItem(BaseModel):
    id: Union[str, int]
    text: str


class AnomalyBatchRequest(BaseModel):
    narratives: List[AnomalyItem]


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict")
def predict(req: PredictRequest):
    """Return severity, event-type suggestion, and anomaly flag for one narrative."""
    clean = preprocess(req.narrative)
    if not clean:
        return {
            "severity": None, "severity_confidence": 0,
            "event_suggestion": None, "event_confidence": 0,
            "is_anomaly": False, "anomaly_score": 0,
        }

    # Severity — model expects a DataFrame with columns [clean, event_type]
    sev_input  = pd.DataFrame({"clean": [clean], "event_type": [req.event_type or "Other"]})
    sev_pred   = severity_clf.predict(sev_input)[0]
    sev_proba  = severity_clf.predict_proba(sev_input)[0]
    sev_conf   = float(np.max(sev_proba))

    # Event-type suggestion — text-only pipeline
    ev_pred  = event_clf.predict([clean])[0]
    ev_proba = event_clf.predict_proba([clean])[0]
    ev_conf  = float(np.max(ev_proba))

    # Anomaly
    vec        = anomaly_vec.transform([clean])
    score      = float(anomaly_det.score_samples(vec)[0])
    is_anomaly = bool(anomaly_det.predict(vec)[0] == -1)

    return {
        "severity":            sev_pred,
        "severity_confidence": sev_conf,
        "event_suggestion":    ev_pred,
        "event_confidence":    ev_conf,
        "is_anomaly":          is_anomaly,
        "anomaly_score":       round(score, 4),
    }


@app.post("/anomaly-batch")
def anomaly_batch(req: AnomalyBatchRequest):
    """Score a batch of narratives for anomaly.  Returns one result per input item."""
    if not req.narratives:
        return []

    texts  = [preprocess(item.text) for item in req.narratives]
    vecs   = anomaly_vec.transform(texts)
    preds  = anomaly_det.predict(vecs)
    scores = anomaly_det.score_samples(vecs)

    return [
        {
            "id":         item.id,
            "is_anomaly": bool(pred == -1),
            "score":      round(float(score), 4),
        }
        for item, pred, score in zip(req.narratives, preds, scores)
    ]
