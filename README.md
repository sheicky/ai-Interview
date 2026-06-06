# AI Interview Practice

A web app where you drop in your CV and a job description, and an AI interviewer
runs a real, role-specific interview, then hands you a report. This branch ships
the **intake** half (the form, the session API, and the session-scoped retrieval
layer) and the **interview brain** (the streaming LLM endpoint the interviewer
speaks through).

> Built on a non-standard build of Next.js. Before changing app or API code, read
> the relevant guide in `node_modules/next/dist/docs/` — APIs and conventions may
> differ from upstream Next.js. See [AGENTS.md](./AGENTS.md).

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), attach a CV (PDF), paste a
job description and company name, and submit. The page calls `POST /api/sessions`
and shows the created `session_id`.

SQLite data is written under `.data/` in the project root (override with the
`DATA_DIR` environment variable). Embeddings and vectors live in Pinecone — set
`PINECONE_API_KEY` and `PINECONE_INDEX` (see [.env.example](./.env.example)). The
integrated index (default name `interview-docs`, model `multilingual-e5-large`)
must already exist.

## What's here

### Intake flow

- **`app/page.tsx`** — the intake form. Collects CV (PDF), job description,
  company name, and an optional company URL, and posts them as
  `multipart/form-data` to the sessions API.
- **`app/api/sessions/route.ts`** — `POST /api/sessions`. Validates the inputs,
  parses the CV PDF, best-effort scrapes the company URL, writes a session row,
  and indexes the documents into the session's Pinecone namespace.
  Returns `{ session_id, company_scraped }`. If indexing fails after the row is
  written, it rolls back both stores so no orphaned, doc-less session is left
  behind. CVs are capped at 5MB.
- **`app/api/llm/route.ts`** — `POST /api/llm`, the interview brain.
  OpenAI-compatible (for ElevenLabs' custom LLM), authenticated by
  `X-Shared-Secret`. Resolves `session_id` from the request extra-body,
  retrieves that session's CV/JD/company docs from Pinecone, builds an
  interviewer system prompt (retrieved text fenced as untrusted reference data),
  and streams the reply from OpenRouter while logging each turn. `GET` is a
  health check.
- **`app/api/report/route.ts`** — `POST /api/report` generates a fixed-rubric
  interview report from the logged transcript + retrieved CV/JD context (one
  OpenRouter call, strict JSON), caches it in the `reports` table, and returns it.
  `?force=1` regenerates. `GET /api/report?session_id=…` returns the stored report.
  Session-scoped (valid `session_id`), no auth.
- **`app/admin/page.tsx`** — `/admin`, a read-only aggregate metrics dashboard
  (server component reading SQLite directly). Shows total interviews, completion
  rate, average overall + per-area scores, score-band distribution, top companies,
  and recent sessions. **No auth — publicly viewable** (an env-password gate can be
  added later).

### Data + retrieval layer

- **`lib/db.ts`** — SQLite (better-sqlite3) data layer. One file under
  `DATA_DIR`, tables created on first import: `sessions`, `turns` (the interview
  transcript), and `reports`.
- **`lib/rag.ts`** — session-scoped RAG over Pinecone. Each `session_id` is its
  own Pinecone namespace, so an interview can only ever retrieve its own CV / JD /
  company docs — a query in one namespace physically cannot see another's. Session
  ids must be real UUIDs before they are used as a namespace name.
- **`lib/pinecone.ts`** — the Pinecone client and a per-session namespace index
  handle. The index uses integrated embeddings (`multilingual-e5-large`), so text
  is embedded server-side on both upsert and query — no embedding model runs in
  the app.
- **`lib/cv.ts`** — parses a CV PDF into plain text (unpdf).
- **`lib/scrape.ts`** — fetches a company page and extracts readable text. Best
  effort: JS-heavy sites yield a thin result, treated as "company name only". A
  user-supplied URL is fetched only after an SSRF guard confirms it resolves to a
  public http(s) address (no private / loopback / link-local / cloud-metadata
  targets); redirects are followed manually and every hop is re-validated.
- **`lib/paths.ts`** — single source of truth for the on-disk `DATA_DIR` (the
  SQLite root). Vector storage now lives in Pinecone, not on disk.

### Interview brain

The brain speaks the OpenAI chat/completions wire protocol so ElevenLabs'
custom LLM can point directly at `/api/llm` without any adapter. The model is
chosen via `OPENROUTER_MODEL` (any slug from
[openrouter.ai/models](https://openrouter.ai/models)).

```bash
curl -N http://localhost:3000/api/llm \
  -H "content-type: application/json" \
  -H "x-shared-secret: $SHARED_SECRET" \
  -d '{"session_id":"<a-real-session-uuid>","messages":[{"role":"user","content":"Hi"}]}'
```

Once the interview is done, generate the report:

```bash
curl -X POST "http://localhost:3000/api/report" \
  -H "content-type: application/json" \
  -d '{"session_id":"<a-real-session-uuid>"}'
```

The report is generated once and cached; add `?force=1` to regenerate, or
`GET /api/report?session_id=…` to fetch the stored one.

## Scripts

- `npm run dev` — start the dev server.
- `npm run build` — production build.
- `npm run start` — serve the production build.
- `npm run lint` — run ESLint.
- `npm run check:isolation` — real Pinecone round-trip + isolation check
  (`scripts/rag-smoke.ts`). It seeds two sessions in separate namespaces, queries
  one with a prompt that pulls semantically toward the other's content, and
  asserts it only ever sees its own docs; then deletes a session and asserts its
  namespace is empty. Requires `PINECONE_API_KEY` / `PINECONE_INDEX` in `.env`.
- `npm run check:brain` — real round-trip for the interview brain
  (`scripts/llm-smoke.ts`): seeds a throwaway session, POSTs an OpenAI-format
  request to `/api/llm`, and asserts a non-empty streamed interviewer reply.
  Requires `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `PINECONE_*`, and
  `SHARED_SECRET` in `.env`.
- `npm run check:report` — real round-trip for the report (`scripts/report-smoke.ts`):
  seeds a session + transcript, POSTs `/api/report`, and asserts a valid fixed-shape
  report (plus cache + `?force` + empty-transcript→422). Requires `OPENROUTER_*` and
  `PINECONE_*` in `.env`.
- `npm run check:metrics` — deterministic unit checks for the admin metrics
  aggregator (`computeMetrics`). No DB or network required.

## Deferred work

Hardening and follow-up items deferred from the pre-landing review (test
framework, residual SSRF DNS-rebind, moving embedding off the request path, data
lifecycle / PII, rate limiting, and more) are tracked in [TODOS.md](./TODOS.md).
