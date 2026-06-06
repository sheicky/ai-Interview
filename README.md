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

## Deferred work

Hardening and follow-up items deferred from the pre-landing review (test
framework, residual SSRF DNS-rebind, moving embedding off the request path, data
lifecycle / PII, rate limiting, and more) are tracked in [TODOS.md](./TODOS.md).
