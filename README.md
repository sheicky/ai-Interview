# AI Interview

Practice a real, role-specific job interview with an AI voice interviewer, then get a scored report.
Video demo : https://www.loom.com/share/89ad497e32cb43009f222db8575e0abf
## How it works

1. **Intake** (`/`) — upload your CV (PDF), paste the job description, name the company.
2. **Interview** (`/interview/[id]`) — a voice interviewer asks role-specific questions and digs into your résumé, grounded in your documents via retrieval.
3. **Report** (`/report/[id]`) — a scored breakdown (technical, communication, role fit, company fit) with strengths and growth areas.
4. **Admin** (`/admin`) — aggregate metrics, behind an access code.

## Stack

- **Next.js 16** (App Router) + TypeScript + React 19
- **Pinecone** — retrieval, one namespace per session (CV / JD / company text)
- **OpenRouter** — the interview brain + report generation (OpenAI-compatible)
- **ElevenLabs** — Conversational AI voice, wired to our own custom LLM endpoint
- **Turso (libSQL)** — sessions, transcripts, reports
- **Vercel** — hosting (auto-deploys from `main`)

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000
```

Create `.env` with the keys below. With no `DATABASE_URL` it falls back to a local SQLite file.

```
PINECONE_API_KEY=
PINECONE_INDEX=interview-docs
OPENROUTER_API_KEY=
OPENROUTER_MODEL=anthropic/claude-sonnet-4.6
SHARED_SECRET=                 # auth between ElevenLabs and /api/llm
ELEVENLABS_API_KEY=
ELEVENLABS_AGENT_ID=
DATABASE_URL=                  # Turso libsql:// URL (omit for a local file)
DATABASE_AUTH_TOKEN=
ADMIN_CODE=                    # code to open /admin
```

## Checks

```bash
npm run check:report     # report round-trip
npm run check:brain      # /api/llm (RAG + stream)
npm run build            # production build
```

## Voice wiring

The ElevenLabs agent's Custom LLM points at `<deploy-url>/api/llm` (base URL — it appends `/chat/completions`) with `SHARED_SECRET` sent as the `x-shared-secret` header. The browser forwards `session_id` via `customLlmExtraBody` so each turn is grounded in that session's documents.
