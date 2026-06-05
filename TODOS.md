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

