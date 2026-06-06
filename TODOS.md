# TODOS

## Deferred

### Swap ElevenLabs transport for a self-built voice pipeline (Approach C)
- **What:** Replace the ElevenLabs Conversational AI transport with a self-built
  streaming pipeline: browser WS/WebRTC → FastAPI orchestrator → streaming STT →
  LLM+RAG → streaming TTS → back. Own VAD, turn detection, and barge-in.
- **Why:** It's the "platform now, swap later" endgame — full control of latency,
  zero platform lock-in, and the deepest learning about how voice agents work.
- **Context:** The brain is built to make this a transport swap, not a rewrite.
  The `/llm` endpoint, the `LLMProvider` interface, the `retriever` module, the
  vector store, and SQLite all stay unchanged; only the layer above the `/llm`
  request line is replaced. See the design doc in
  `~/.gstack/projects/sheicky-ai-Customer-Service/` (Approach C section).
- **Effort:** XL (human ~2-3 weeks / CC ~1-2 days).
- **Depends on / blocked by:** Ship the ElevenLabs demo first; keep the
  `LLMProvider` + `retriever` seams clean so this stays a swap, not a rewrite.

### Admin dashboard polish (deferred design pass)
- **What:** Give the admin dashboard a single hero number (total calls) above the
  top-questions list and a warm zero-calls empty state; run a full responsive +
  accessibility pass on it.
- **Why:** The design review focused on the call screen; the dashboard got a
  lighter pass. A flat list with no hierarchy and a cold empty state is the
  default AI-dashboard look.
- **Context:** Call screen is fully designed (see the design doc's Design
  Decisions + the approved wireframe). The dashboard only needs hierarchy + states.
- **Depends on / blocked by:** Dashboard exists (eng task T10).

### Interview-intake follow-ups (from /ship review of PR #2)

These were surfaced by the pre-landing review of `feat/interview-intake` and
deliberately deferred (the four highest-value fixes — SSRF guard, route
rollback, idempotent table create, session-id validation — already landed in the
PR). Listed roughly by priority.

- **[P0] Stand up a test framework + pin the isolation guarantee to production code.**
  No test runner exists; `scripts/check-isolation.mjs` re-implements the embed +
  `.where(session_id)` path and never imports `lib/rag.ts`, so a regression in the
  real `retrieve()`/`escapeSql()` wouldn't be caught. Add vitest and an isolation
  test that calls the real `addSessionDocs()`/`retrieve()` against a temp `DATA_DIR`.
  Sequence this with the Pinecone migration so embedding-internal tests aren't thrown away.
- **[P1][security] Close the residual SSRF DNS-rebind.** `lib/scrape.ts` validates the
  resolved IP and re-validates every redirect hop, but `fetch` re-resolves the
  hostname independently, so an attacker-controlled domain with a short TTL can
  rebind to an internal IP between our check and the connect. Pin the connection to
  the validated IP (undici dispatcher / custom `lookup`).
- **[P1][availability] Move embedding off the request path.** The ~80MB model
  downloads lazily inside the first `POST /api/sessions`, and feature-extraction runs
  synchronously on the main thread, blocking the event loop and risking the 60s
  timeout. Warm the model at startup (instrumentation `register()`), run inference in
  a worker thread, and index in the background (return `session_id` immediately,
  mark the session `indexing` → `ready`).
- **[P1][security] Treat scraped/CV text as untrusted at the LLM boundary.** Company
  HTML and CV text are stored raw in RAG and will later be fed to the interviewer
  LLM (voice branch). Wrap retrieved docs as reference data (not instructions) in the
  prompt to blunt stored/second-order prompt injection.
- **[P2][privacy] Data lifecycle / PII.** CVs (names, contact, history) persist
  indefinitely in SQLite + LanceDB with no deletion path or TTL. Add `deleteSession`
  cascade (now exists for SQLite; extend to LanceDB via `deleteSessionDocs`) + a
  retention sweep, and document the policy.
- **[P2][abuse] Input ceilings + rate limiting.** `jd`/`companyText` have no
  server-side length cap and `req.formData()` buffers the whole body before the 5MB
  CV check; there's no rate limiting. Cap text lengths, guard `Content-Length`, add a
  basic limiter.
- **[P3][perf] LanceDB vector index.** The shared `docs` table has no vector index;
  `retrieve()` is a brute-force scan that grows with total corpus size. Build an
  IVF_PQ/HNSW index (or partition per session) once it has enough rows.
- **[P3][correctness] Reject empty-RAG sessions.** A CV whose text collapses to empty
  after whitespace normalization passes the `!cvText` guard but yields zero chunks,
  so a "ready" session can have no retrievable context. Assert the CV produced ≥1
  chunk; otherwise 422.

