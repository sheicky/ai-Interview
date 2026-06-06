# AI Interview Practice

A web app where you drop in your CV and a job description, and an AI interviewer
runs a real, role-specific **voice** interview grounded in your documents, then
hands you a report. This branch ships the **intake** half (the form, the session
API, and the session-scoped retrieval layer), the **interview brain** (the
streaming LLM endpoint the voice interviewer speaks through), and the **voice
interview UI** — the live voice interview screen and the post-interview report
view.

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

Local dev uses a `file:` libSQL database (no credentials needed). Embeddings
and vectors live in Pinecone — set `PINECONE_API_KEY` and `PINECONE_INDEX` (see
[.env.example](./.env.example)). The integrated index (default name
`interview-docs`, model `multilingual-e5-large`) must already exist.

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
- **`app/api/llm/route.ts`** — `GET /api/llm` health check (returns
  `{"ok":true}`).
- **`app/api/llm/chat/completions/route.ts`** — the ElevenLabs custom-LLM
  endpoint. OpenAI-compatible streaming (`POST`). Auth: `Authorization: Bearer
  <SHARED_SECRET>` (or `x-shared-secret` header). Resolves `session_id` from
  `session_id`, `elevenlabs_extra_body.session_id`,
  `dynamic_variables.session_id`, or `system__session_id` in the request body.
  Delegates to the shared brain (`lib/brain.ts`), so the voice interview is
  fully RAG-grounded in the session's CV, JD, and company docs.
- **`app/api/elevenlabs/token/route.ts`** — `GET /api/elevenlabs/token`. Mints
  a short-lived WebRTC conversation token server-side using `ELEVENLABS_API_KEY`
  + `ELEVENLABS_AGENT_ID`, so the browser never holds the API key.
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
- **`app/interview/[sessionId]/page.tsx`** — the voice interview screen
  (client). Powered by ElevenLabs Conversational AI: shows an animated orb,
  captions while the AI is speaking, a mute toggle, and an End button. No text
  input — the exchange is entirely spoken. On End it POSTs `/api/report` and
  navigates to `/report/[sessionId]`.
- **`app/report/[sessionId]/page.tsx`** — server-rendered view of the stored
  report (overall + per-area scores, strengths/gaps/next steps).
- **`app/api/chat/route.ts`** — browser-facing turn endpoint. Session-scoped, no
  shared secret; shares the brain core (`lib/brain.ts`) with `/api/llm` and returns
  the same OpenAI SSE.

### Data + retrieval layer

- **`lib/db.ts`** — libSQL/Turso data layer. Local dev uses a `file:` DB (no
  credentials needed); production uses `DATABASE_URL` (`libsql://…` from Turso)
  + `DATABASE_AUTH_TOKEN`. Tables created on first import: `sessions`, `turns`
  (the interview transcript), and `reports`.
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
curl -N http://localhost:3000/api/llm/chat/completions \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $SHARED_SECRET" \
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
- `npm run check:chat` — real round-trip for `/api/chat` (`scripts/chat-smoke.ts`):
  seeds a session, asserts a streamed reply plus 400/404 guards. Requires
  `OPENROUTER_*` and `PINECONE_*` in `.env`.
- `npm run check:token` — mocked unit test of the ElevenLabs token route (no
  network/keys).

## Deploy (Vercel + voice)

The steps below are a complete runbook from a clean repo to a live, voice-enabled
interview app. Work through them in order.

1. **Create a Turso database.** Go to [turso.tech](https://turso.tech), create a
   new database, and note its `libsql://…` URL and auth token.

2. **Push the repo to GitHub and import it into Vercel.** Vercel auto-detects
   Next.js; no extra framework config is needed.

3. **Set environment variables** in the Vercel project settings:
   - `DATABASE_URL` — your Turso `libsql://…` URL
   - `DATABASE_AUTH_TOKEN` — your Turso auth token
   - `OPENROUTER_API_KEY`
   - `OPENROUTER_MODEL` — any slug from [openrouter.ai/models](https://openrouter.ai/models)
   - `PINECONE_API_KEY`
   - `PINECONE_INDEX` — name of your integrated-embedding index
   - `SHARED_SECRET` — a secret string you choose; the brain endpoint checks this
   - `ELEVENLABS_API_KEY`
   - `ELEVENLABS_AGENT_ID` — set this **after** step 5 (you don't have it yet)

4. **Deploy.** Confirm the app is live:
   - `GET https://<your-app>.vercel.app/api/llm` should return `{"ok":true}`
     (health check).
   - The brain is reachable at
     `https://<your-app>.vercel.app/api/llm/chat/completions`.

5. **Create the ElevenLabs agent** (dashboard → Agents → create):
   - **LLM:** choose **Custom LLM**. Server URL:
     `https://<your-app>.vercel.app/api/llm` (ElevenLabs appends
     `/chat/completions` automatically; if your account requires the full path,
     use `https://<your-app>.vercel.app/api/llm/chat/completions`). Set any
     value for Model ID — the brain ignores it and uses `OPENROUTER_MODEL`.
   - **API key secret:** create a secret whose **value is your `SHARED_SECRET`**.
     ElevenLabs sends it as `Authorization: Bearer`, which the route checks.
   - **Dynamic variables / extra body:** enable forwarding and declare a
     `session_id` dynamic variable so `session_id` reaches the request body. The
     brain reads it from `session_id`, `elevenlabs_extra_body.session_id`,
     `dynamic_variables.session_id`, or `system__session_id`.
   - Set a voice and a token limit (~5000). **Publish.**
   - Copy the **Agent ID** into Vercel env as `ELEVENLABS_AGENT_ID`, then
     **redeploy**.

6. **Manual voice check** (cannot be automated): open
   `https://<your-app>.vercel.app`, submit intake, click **Start interview →**,
   allow the mic, and confirm:
   - The interviewer speaks first.
   - Questions **reference your actual CV/JD** — this proves `session_id` reached
     the brain and RAG is grounded.
   - The interviewer follows up on your answers.
   - **End interview** navigates to the report at `/report/[id]`.
   - If questions are generic (not about your CV), the `session_id`
     dynamic-variable forwarding in step 5 is not reaching the LLM — fix that
     mapping in the ElevenLabs agent config.

> **Local voice testing without deploying** requires a public tunnel (e.g.
> `ngrok http 3000`) pointed at your local dev server as the agent's server URL,
> since ElevenLabs must reach the brain over the internet.

## Deferred work

Hardening and follow-up items deferred from the pre-landing review (test
framework, residual SSRF DNS-rebind, moving embedding off the request path, data
lifecycle / PII, rate limiting, and more) are tracked in [TODOS.md](./TODOS.md).
