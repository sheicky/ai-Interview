# AI Interview Practice

A web app where you drop in your CV and a job description, and an AI interviewer
runs a real, role-specific interview, then hands you a report. This branch ships
the **intake** half: the form, the session API, and the session-scoped retrieval
layer that the interview will later read from.

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

By default all data is written under `.data/` in the project root. Override the
location with the `DATA_DIR` environment variable.

## What's here

### Intake flow

- **`app/page.tsx`** — the intake form. Collects CV (PDF), job description,
  company name, and an optional company URL, and posts them as
  `multipart/form-data` to the sessions API.
- **`app/api/sessions/route.ts`** — `POST /api/sessions`. Validates the inputs,
  parses the CV PDF, best-effort scrapes the company URL, writes a session row,
  and indexes the documents into the vector store tagged with the session id.
  Returns `{ session_id, company_scraped }`. If indexing fails after the row is
  written, it rolls back both stores so no orphaned, doc-less session is left
  behind. CVs are capped at 5MB.

### Data + retrieval layer

- **`lib/db.ts`** — SQLite (better-sqlite3) data layer. One file under
  `DATA_DIR`, tables created on first import: `sessions`, `turns` (the interview
  transcript), and `reports`.
- **`lib/rag.ts`** — session-scoped RAG over LanceDB. Every document row is
  tagged with its `session_id`, and retrieval filters on it, so an interview can
  only ever retrieve its own CV / JD / company docs. Session ids must be real
  UUIDs before they reach the filter.
- **`lib/embeddings.ts`** — local sentence embeddings via transformers.js
  (`Xenova/all-MiniLM-L6-v2`, 384-dim). The model downloads once on first use and
  is cached on disk; no embedding API calls after that.
- **`lib/cv.ts`** — parses a CV PDF into plain text (unpdf).
- **`lib/scrape.ts`** — fetches a company page and extracts readable text. Best
  effort: JS-heavy sites yield a thin result, treated as "company name only". A
  user-supplied URL is fetched only after an SSRF guard confirms it resolves to a
  public http(s) address (no private / loopback / link-local / cloud-metadata
  targets); redirects are followed manually and every hop is re-validated.
- **`lib/paths.ts`** — single source of truth for the on-disk `DATA_DIR` and
  LanceDB locations, so the SQLite and vector stores can't drift onto different
  roots.

## Scripts

- `npm run dev` — start the dev server.
- `npm run build` — production build.
- `npm run start` — serve the production build.
- `npm run lint` — run ESLint.
- `npm run check:isolation` — adversarial session-isolation check
  (`scripts/check-isolation.mjs`). It queries as one session using a prompt that
  pulls semantically toward a different session's content, and asserts the
  `session_id` filter still returns only the querying session's docs.

## Deferred work

Hardening and follow-up items deferred from the pre-landing review (test
framework, residual SSRF DNS-rebind, moving embedding off the request path, data
lifecycle / PII, rate limiting, and more) are tracked in [TODOS.md](./TODOS.md).
