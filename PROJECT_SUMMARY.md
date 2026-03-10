# Twin Project Summary

This repository is a small “AI Digital Twin” web app:

- **Frontend**: a **Next.js** chat UI that’s built as a **static export** and calls the backend over HTTPS.
- **Backend**: a **FastAPI** API that calls **AWS Bedrock** (via `boto3`’s `bedrock-runtime`) and is designed to run both **locally (Uvicorn)** and in **AWS Lambda (Mangum adapter)**.
- **Data storage**:
  - “Persona/context” data lives in `backend/data/`.
  - Conversation history (“memory”) is stored either **locally** in `memory/` or in **S3**, controlled by env vars.
- **Cloud orchestration (most important)**: AWS **Lambda + API Gateway + S3 + CloudFront**, documented in `week2/day2.md` and partially implemented by `backend/deploy.py` (builds the Lambda zip package).

---

## Repository layout

High-signal folders/files:

- **`frontend/`**: Next.js app (static export) + chat component
  - `frontend/app/page.tsx`: home page mounts the chat UI
  - `frontend/components/twin.tsx`: the chat client (calls API Gateway)
  - `frontend/next.config.ts`: `output: 'export'` (static build to `frontend/out/`)
- **`backend/`**: FastAPI + Bedrock + Lambda packaging
  - `backend/server.py`: FastAPI app + endpoints + Bedrock + memory storage
  - `backend/lambda_handler.py`: Lambda entrypoint via Mangum (`handler = Mangum(app)`)
  - `backend/deploy.py`: creates `lambda-deployment.zip` using the Lambda runtime container image
  - `backend/context.py`, `backend/resources.py`, `backend/data/*`: persona/context prompt sources
- **`memory/`**: local conversation history files (`<session_id>.json`) when not using S3
- **`week2/`**: course-style step-by-step docs; `week2/day2.md` is the main “AWS production deployment” guide

Build artifacts currently present in-repo:

- `backend/lambda-deployment.zip`, `backend/lambda-package/`
- `frontend/.next/`, `frontend/out/`

---

## Frontend (Next.js)

### Tech stack

- **Next.js** (`next@16.1.6`) + **React 19**
- **Tailwind CSS** (via `@import 'tailwindcss'` in `frontend/app/globals.css`)
- **lucide-react** icons (used in the chat UI)

### Main UI flow

- The home page (`frontend/app/page.tsx`) renders `Twin` in a fixed-height panel.
- The chat UI is implemented in `frontend/components/twin.tsx`:
  - Keeps `messages` in state
  - Keeps a `sessionId` in state (returned by the backend)
  - Sends `{ message, session_id }` to the backend on Enter / send button

### Backend integration

The frontend currently calls a **hardcoded API Gateway URL**:

- `https://rb9z9fm1jd.execute-api.us-east-2.amazonaws.com/chat`

The response is expected to be JSON shaped like:

- `{"response": "...", "session_id": "..."}`

### Build / deployment shape

`frontend/next.config.ts` sets:

- `output: 'export'` → `npm run build` produces static files in `frontend/out/`
- `images.unoptimized: true` → required for static export without Next image optimization server

This “static export” design matches an **S3 static hosting + CloudFront** deployment model (see Cloud Orchestration section).

---

## Backend (FastAPI + AWS Bedrock)

### Tech stack

- **Python 3.12**
- **FastAPI** + **Uvicorn** (local dev server)
- **Mangum** (adapts ASGI to AWS Lambda events)
- **boto3** (AWS SDK; used for Bedrock + optionally S3)
- **pypdf** (extracts text from `backend/data/linkedin.pdf`)
- **python-dotenv** (loads `.env` for local dev)

### API endpoints

Defined in `backend/server.py`:

- **`GET /`**: basic API info (`storage` = `local` or `S3`, `ai_model` = `BEDROCK_MODEL_ID`)
- **`GET /health`**: health check
- **`POST /chat`**:
  - request: `{ message: string, session_id?: string }`
  - response: `{ response: string, session_id: string }`
  - behavior:
    - if no session id is provided, generates a UUID
    - loads conversation memory (S3 or local file)
    - calls AWS Bedrock to generate the assistant reply
    - appends user + assistant messages to memory and saves it back
- **`GET /conversation/{session_id}`**: returns stored conversation history

### Model inference: AWS Bedrock `converse`

In `backend/server.py` the backend creates a Bedrock Runtime client:

- `boto3.client("bedrock-runtime", region_name=DEFAULT_AWS_REGION)`

And uses:

- `bedrock_client.converse(modelId=BEDROCK_MODEL_ID, messages=[...], inferenceConfig={...})`

The “system prompt” is currently injected as a **first `user` message** prefixed with `"System: ..."` (see `call_bedrock()`), built by `context.prompt()`.

### Persona/context prompt sources

`backend/resources.py` reads:

- `backend/data/facts.json` (structured personal facts)
- `backend/data/summary.txt` (freeform bio summary)
- `backend/data/style.txt` (communication style constraints)
- `backend/data/linkedin.pdf` (parsed via `pypdf`)

`backend/context.py` formats these into a long prompt that instructs the model to act as the twin.

### Conversation memory (“state”)

Controlled by env vars in `backend/server.py`:

- `USE_S3` (default `"false"`)
- `S3_BUCKET` (bucket name when `USE_S3=true`)
- `MEMORY_DIR` (default `"../memory"` for local file mode)

Storage formats:

- Key/path: `<session_id>.json`
- Value: JSON array of messages like:
  - `{ role: "user" | "assistant", content: string, timestamp: ISO8601 string }`

Local mode writes under `memory/` (repo root). S3 mode reads/writes objects in your bucket.

### CORS

CORS is configured via `CORS_ORIGINS`:

- defaults to `http://localhost:3000`
- allows `GET`, `POST`, `OPTIONS`

This is crucial when the frontend is hosted on CloudFront or elsewhere: the backend must include that origin in `CORS_ORIGINS`.

---

## Data storage summary

### “Persona data” (static content shipped with the backend)

- **Location**: `backend/data/`
- **Purpose**: seed the twin’s identity and background for prompt construction
- **In Lambda**: `backend/deploy.py` copies `data/` into the deployment package, so it’s available at runtime

### “Memory” (dynamic conversation state)

Two modes:

- **Local dev**: file-based JSON in `memory/`
  - good for local testing
  - not suitable for Lambda in production (Lambda filesystem is mostly read-only; `/tmp` is ephemeral)
- **Production**: **S3** object storage
  - durable memory per session id
  - supports horizontal scaling naturally (any Lambda instance can load the same session)

---

## Cloud orchestration (AWS) — detailed

The intended production architecture is:

- **Static frontend**: Next.js export hosted on **S3 static website hosting**, fronted by **CloudFront**
- **Backend API**: FastAPI running on **AWS Lambda**, invoked through **API Gateway (HTTP API)**
- **Conversation memory**: **S3 bucket** for `<session_id>.json` conversation logs (optional but recommended)
- **Model inference**: **AWS Bedrock** via `bedrock-runtime` (`converse`)

The “how-to” is described in `week2/day2.md`, and the code implements the core runtime pieces.

### 1) Lambda packaging & runtime model

Key implementation files:

- `backend/lambda_handler.py`:
  - exposes `handler = Mangum(app)` for API Gateway proxy events
- `backend/deploy.py`:
  - builds a **Lambda-compatible deployment zip** using Docker
  - uses `public.ecr.aws/lambda/python:3.12` to ensure manylinux-compatible wheels
  - forces `--platform linux/amd64` (x86_64) to match the chosen Lambda architecture

Generated artifacts (currently present):

- `backend/lambda-deployment.zip`: zip uploaded to Lambda
- `backend/lambda-package/`: expanded site-packages + app code used to build the zip

Operational note:

- The package is ~24MB in this repo; cold start latency and zip size limits matter.

### 2) AWS Lambda configuration (expected)

Based on `week2/day2.md` and `backend/server.py`:

- **Runtime**: Python 3.12
- **Architecture**: x86_64 (matches `deploy.py`)
- **Handler**: `lambda_handler.handler`
- **Timeout**: increase (the guide suggests 30s) since LLM calls can be slow
- **Environment variables** (minimum set for this codebase):
  - `DEFAULT_AWS_REGION` (Bedrock region; must support your chosen model)
  - `BEDROCK_MODEL_ID` (defaults to `global.amazon.nova-2-lite-v1:0`)
  - `CORS_ORIGINS` (should match your CloudFront domain, e.g. `https://dxxxx.cloudfront.net`)
  - `USE_S3=true` (recommended for production)
  - `S3_BUCKET=<your-memory-bucket>`

### 3) IAM permissions (execution role)

Your Lambda execution role must be able to:

- **Call Bedrock**:
  - `bedrock:InvokeModel` (and any Bedrock permissions required by `converse` in your account/region)
- **Read/write S3 objects** (if `USE_S3=true`):
  - `s3:GetObject`, `s3:PutObject` for your memory bucket/prefix
- **Write logs**:
  - `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`

The `week2/day2.md` guide suggests broad policies for learning (e.g. full access). For real production, scope these down to least privilege.

### 4) API Gateway (HTTP API) orchestration

The backend is designed for API Gateway “proxy” style integration:

- Routes used by the app:
  - `POST /chat`
  - `GET /health`
  - `GET /conversation/{session_id}`

API Gateway responsibilities:

- **Routing**: map HTTP routes to the Lambda integration
- **CORS**:
  - must allow the CloudFront domain (or `*` during initial testing)
  - must allow `POST` and `OPTIONS` for the chat endpoint

Important detail from the guide:

- Mangum expects certain fields in the API Gateway v2 event (e.g. `requestContext.http.method`), which is why the guide shows a specific test event shape.

### 5) S3 buckets (two-bucket model)

You typically use:

1) **Memory bucket** (private):
   - stores per-session conversation JSON blobs
   - referenced by `S3_BUCKET`

2) **Frontend bucket** (public website hosting):
   - hosts `frontend/out/` as a static website
   - used as CloudFront origin (S3 static website endpoint)

### 6) CloudFront distribution (frontend CDN)

The guide in `week2/day2.md` uses CloudFront in front of the S3 static website endpoint.

Critical configuration highlights:

- **Origin**: S3 *website endpoint* (not the S3 REST endpoint)
- **Origin protocol policy**: **HTTP only** (S3 static hosting doesn’t do HTTPS at the origin)
- **Viewer protocol policy**: redirect HTTP → HTTPS
- **Allowed methods**: GET/HEAD (static content)

Then:

- Set backend `CORS_ORIGINS` to your CloudFront domain (e.g. `https://dxxxx.cloudfront.net`) so the browser can call the API.

### 7) End-to-end request flow (production)

1) User visits CloudFront URL → CloudFront serves static Next.js export from S3.
2) Browser runs `Twin` component and sends `POST /chat` to API Gateway invoke URL.
3) API Gateway triggers the Lambda.
4) Lambda runs FastAPI via Mangum:
   - loads prompt context from `backend/data/*`
   - loads conversation memory from S3 (recommended) or local (dev)
   - calls Bedrock `converse`
   - stores updated memory back to S3
5) Response returns to the browser; the UI appends assistant message.

### 8) Region consistency callout

- The frontend fetch URL currently points to API Gateway in **`us-east-2`**.
- The backend defaults Bedrock region to **`us-east-1`** unless `DEFAULT_AWS_REGION` is set.

This is fine (API Gateway/Lambda region can differ from Bedrock region), but in practice you’ll want to:

- ensure the Lambda has correct `DEFAULT_AWS_REGION`
- ensure the chosen `BEDROCK_MODEL_ID` is available in that region
- keep your infra choices deliberate to reduce latency and confusion

---

## Local development workflow

Backend (local):

- Run `uvicorn server:app --reload` inside `backend/`
- Uses `.env` via `python-dotenv` (if readable in your environment)
- Stores memory in `memory/` by default (`MEMORY_DIR=../memory`)

Frontend (local):

- Run `npm run dev` inside `frontend/`
- For local dev, you’d typically point the fetch URL at `http://localhost:8000/chat` (the course guide shows this swap), but this repo currently points to the deployed API Gateway URL.

---

## Documentation / learning artifacts

- `week2/day2.md` is effectively an “ops runbook” for deploying this project with:
  - Lambda packaging/upload
  - API Gateway setup + CORS
  - S3 buckets for memory + static hosting
  - CloudFront distribution configuration and cache invalidation

---

## Practical notes / gaps (current state of repo)

- **No Infrastructure-as-Code**: there are no Terraform/CDK/SAM/CloudFormation files; orchestration is described in docs and done via AWS Console/CLI.
- **Hardcoded API URL in frontend**: `frontend/components/twin.tsx` points to a specific API Gateway invoke URL. In a reusable setup, this is usually an env var (e.g. `NEXT_PUBLIC_API_BASE_URL`).
- **Build artifacts committed**: `frontend/out/`, `frontend/.next/`, `backend/lambda-package/`, and `backend/lambda-deployment.zip` are present. Many teams keep these out of git and produce them in CI.

