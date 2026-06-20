"""Trains and saves the anomaly detector (IsolationForest on TF-IDF + LSA vectors).

Run from the ml/ directory:
    python train_anomaly.py
"""
import os, re
import pandas as pd
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.decomposition import TruncatedSVD
from sklearn.preprocessing import Normalizer
from sklearn.pipeline import make_pipeline
from sklearn.ensemble import IsolationForest
import joblib

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_PATH    = os.path.join(HERE, "data", "shift_log_synthetic.csv")
ARTIFACT_DIR = os.path.join(HERE, "artifacts")
os.makedirs(ARTIFACT_DIR, exist_ok=True)

df = pd.read_csv(DATA_PATH)
print(f"Loaded {len(df):,} rows")

def preprocess(t):
    t = str(t).lower()
    t = re.sub(r"[^a-z0-9\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()

df["clean"] = df["narrative"].apply(preprocess)

# Build a TF-IDF → SVD/LSA → L2-normalise vectoriser pipeline
# (same hyperparameters as the topic modelling notebook so vectors are comparable)
tfidf = TfidfVectorizer(
    ngram_range=(1, 2),
    min_df=3,
    max_df=0.80,
    sublinear_tf=True,
    stop_words="english",
)
svd  = TruncatedSVD(n_components=50, random_state=42)
norm = Normalizer(copy=False)
vec_pipe = make_pipeline(tfidf, svd, norm)

X = vec_pipe.fit_transform(df["clean"])
print(f"Vector shape: {X.shape}")

# IsolationForest — contamination=0.05 means the model expects ~5% of
# incoming narratives to be anomalous relative to the training distribution.
iso = IsolationForest(n_estimators=200, contamination=0.05, random_state=42)
iso.fit(X)

train_scores = iso.score_samples(X)
threshold    = np.percentile(train_scores, 5)
flagged      = (iso.predict(X) == -1).sum()
print(f"Training anomaly threshold : {threshold:.4f}")
print(f"Flagged as anomalous       : {flagged} / {len(df)} ({flagged/len(df):.1%})")

out_vec = os.path.join(ARTIFACT_DIR, "anomaly_vectorizer.joblib")
out_iso = os.path.join(ARTIFACT_DIR, "anomaly_detector.joblib")
joblib.dump(vec_pipe, out_vec)
joblib.dump(iso,      out_iso)
print(f"Saved: {out_vec}  ({os.path.getsize(out_vec)//1024} KB)")
print(f"Saved: {out_iso}  ({os.path.getsize(out_iso)//1024} KB)")
