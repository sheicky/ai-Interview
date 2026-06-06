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

- **[P0] Stand up a real test runner.** Partly addressed by the Pinecone migration:
  `scripts/rag-smoke.ts` (`npm run check:isolation`) now calls the *real*
  `addSessionDocs()`/`retrieve()`/`deleteSessionDocs()` and asserts cross-namespace
  isolation, so a regression in production RAG code is caught. Remaining gap: no
  unit-test runner (add vitest) and the smoke needs a live Pinecone index + `.env`,
  so it can't run hermetically in CI. Decide between a CI Pinecone project (or a
  dedicated test-namespace prefix) vs. mocking the Pinecone client for unit tests.
- **[P1][security] Close the residual SSRF DNS-rebind.** `lib/scrape.ts` validates the
  resolved IP and re-validates every redirect hop, but `fetch` re-resolves the
  hostname independently, so an attacker-controlled domain with a short TTL can
  rebind to an internal IP between our check and the connect. Pin the connection to
  the validated IP (undici dispatcher / custom `lookup`).
- **[P1][availability] Index in the background.** Mostly addressed by the Pinecone
  migration: the ~80MB local model that downloaded lazily and ran feature-extraction
  on the main thread is gone, so embedding no longer blocks the event loop. Remaining:
  `POST /api/sessions` still `await`s the Pinecone upserts (a network call that embeds
  server-side) before returning, so a large CV can still approach the 60s timeout.
  Return `session_id` immediately and index in the background, marking the session
  `indexing` → `ready`.
- **[P1][security] Treat scraped/CV text as untrusted at the LLM boundary.** Company
  HTML and CV text are stored raw in RAG and will later be fed to the interviewer
  LLM (voice branch). Wrap retrieved docs as reference data (not instructions) in the
  prompt to blunt stored/second-order prompt injection.
- **[P2][privacy] Data lifecycle / PII.** CVs (names, contact, history) persist
  indefinitely in SQLite + Pinecone with no deletion path or TTL. The building blocks
  exist (`deleteSession` for SQLite, `deleteSessionDocs` clears the Pinecone
  namespace); wire them into a user-facing delete + a retention sweep, and document
  the policy.
- **[P2][abuse] Input ceilings + rate limiting.** `jd`/`companyText` have no
  server-side length cap and `req.formData()` buffers the whole body before the 5MB
  CV check; there's no rate limiting. Cap text lengths, guard `Content-Length`, add a
  basic limiter.
- **[P3][perf] ~~LanceDB vector index~~ (resolved by Pinecone migration).** No longer
  applicable: Pinecone serverless builds and maintains the ANN index per namespace, so
  retrieval is no longer a brute-force scan over a shared table.
- **[P3][correctness] Reject empty-RAG sessions.** A CV whose text collapses to empty
  after whitespace normalization passes the `!cvText` guard but yields zero chunks,
  so a "ready" session can have no retrievable context. Assert the CV produced ≥1
  chunk; otherwise 422.

