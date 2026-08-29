# DevCraft — Deployment Guide

## Prerequisites

- **Node.js ≥ 18** (for ES module support and native `fetch`)
- **Python 3** (for running `score.py`)
- **Vercel CLI** (`npm i -g vercel`) for local dev and deployment
- A **HuggingFace Inference Endpoint** running Qwen2.5-7B-Instruct (dedicated, not the free serverless API)
- A **Firebase project** with Firestore enabled

---

## Environment Variables

### Vercel Dashboard → Settings → Environment Variables

These **must** be set before the online LLM path works:

| Variable | Required | Secret | Description |
|---|---|---|---|
| `HF_ENDPOINT_URL` | Yes (for online parsing) | Yes | Full URL of the HuggingFace Inference Endpoint, e.g. `https://xyz.endpoints.huggingface.cloud` |
| `HF_API_TOKEN` | Yes (for online parsing) | Yes | HuggingFace API token with access to the endpoint |

> **Without these two variables**, the serverless function at `/api/parse-message` returns
> `{ _parse_error: "HF endpoint not configured" }` and the client automatically falls back
> to the offline rules parser. The app still works — you just lose the LLM accuracy boost.

### Firebase Config (NOT environment variables)

Firebase project values are **not secrets** and are committed directly in
[`firebase-config.js`](firebase-config.js) per the existing code comments. Fill in:

| Value | Where | Description |
|---|---|---|
| `apiKey` | `firebase-config.js` | Firebase Web API key (public identifier) |
| `authDomain` | `firebase-config.js` | `<project>.firebaseapp.com` |
| `projectId` | `firebase-config.js` | Firebase project ID |
| `storageBucket` | `firebase-config.js` | `<project>.appspot.com` |
| `messagingSenderId` | `firebase-config.js` | Cloud Messaging sender ID |
| `appId` | `firebase-config.js` | Firebase App ID |

Find these in: Firebase Console → Project Settings → General → Your apps → SDK setup and configuration.

---

## Deploy to Vercel

### First-time setup

```bash
cd backend
npm install
vercel login
vercel link        # link to your Vercel project
```

### Set environment variables

```bash
vercel env add HF_ENDPOINT_URL    # paste the full URL
vercel env add HF_API_TOKEN       # paste the token
```

### Deploy

```bash
vercel --prod
```

### Verify the serverless function

```bash
curl -X POST https://<your-deployment>.vercel.app/api/parse-message \
  -H "Content-Type: application/json" \
  -d '{"message":"2 kurta navy blue, parso tak","received_at":"2026-08-29T10:00:00+05:30","domain":"tailor"}'
```

Expected: a JSON object with the seven schema fields. If HF creds aren't set, you'll get `{ "_parse_error": "HF endpoint not configured" }` (which is correct — the client-side code handles this gracefully).

---

## Local Development

```bash
cd backend
npm install
vercel dev          # starts local dev server with serverless function support
```

This serves static files and routes `/api/parse-message` to the serverless function locally.

---

## Running Tests

### Parser accuracy (rules-only, no network needed)

```bash
node test-parser.js messages_train.json pred.json
python score.py --gold messages_train.json --pred pred.json
```

Expected score: **0.817** (field: 0.742, date: 0.924, clarification: 0.936).

### Sync/conflict-resolution determinism

```bash
node test-sync.js
```

Expected: all 3 scenarios PASS, deterministic under both reconnection orders.

### Batch runner (Test A judging entry point)

```bash
# Rules-only mode (no network needed)
node batch-runner.js messages_train.json submission.json --mode rules
python score.py --gold messages_train.json --pred submission.json

# Full pipeline mode (requires HF endpoint + env vars)
HF_ENDPOINT_URL=... HF_API_TOKEN=... node batch-runner.js messages_train.json submission.json --mode full
```

---

## Architecture Overview

```
Browser (teammate's UI)
  ├── orchestrator.js ──→ parse-message.js ──→ /api/parse-message (online, 8s timeout)
  │                                         └→ rules-parser.js   (offline fallback)
  ├── order-service.js ──→ Firestore (persistentLocalCache)
  └── sync-service.js  ──→ reconcileOrder() on reconnect

Vercel
  └── api/parse-message.js ──→ HuggingFace Inference Endpoint (Qwen2.5-7B-Instruct)
```
