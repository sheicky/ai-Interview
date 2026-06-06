# Voice interview (ElevenLabs Conversational AI) + Vercel deploy

**Date:** 2026-06-07
**Branch:** feat/voice-interview off main
**Status:** Design — approved, pending implementation
**Builds on:** the brain (`lib/brain.ts`), libSQL persistence (PR #10), the text screen (replaced here).

## Goal

Turn `/interview/[sessionId]` into a **voice-only** spoken interview (Zara / Braintrust-AIR
style): ElevenLabs handles the real-time audio; **our brain (`lib/brain.ts`) is the
agent's custom LLM**, so the interview stays RAG-grounded in the candidate's CV/JD.
Then deploy to Vercel (which also gives the public URL ElevenLabs needs).

## Decisions (locked)

1. **ElevenLabs Conversational AI**, our `/api/llm` brain as the **custom LLM** →
   RAG works unchanged (retrieval keys on `session_id` carried through).
2. **Voice-only UI:** no text input. Screen = an audio-reactive **orb** + **End**
   control + **captions shown only while the interviewer (AI) is speaking**.
3. **WebRTC**, token minted **server-side** (API key never reaches the browser).
4. **Deploy on Vercel**; secrets (ElevenLabs, Turso, OpenRouter, Pinecone, shared
   secret) as Vercel env vars. Deploying satisfies the custom-LLM public-URL need.

## What only the user can provide (irreducible)
- `ELEVENLABS_API_KEY` + an ElevenLabs **agent** (created via the setup script or
  dashboard) whose Custom LLM points at the deployed `…/api/llm/chat/completions`
  with the shared secret, and `ELEVENLABS_AGENT_ID`.
- Turso `DATABASE_URL` + `DATABASE_AUTH_TOKEN` (prod DB).
- The Vercel project (their account).

## SDK facts (from live docs, @elevenlabs/react 1.6.4)
- `ConversationProvider` + `useConversation()`; `startSession({ conversationToken, dynamicVariables })` (voice → WebRTC); reactive `status` ("disconnected"|"connecting"|"connected"), `isSpeaking`, `isListening`; `onMessage({message, source})` for transcripts; `getOutputByteFrequencyData()` for the orb; `endSession()`. Requires mic permission (`getUserMedia`).
- WebRTC token: `GET https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=…` with header `xi-api-key` → returns a token.
- Custom LLM: OpenAI `/chat/completions`; the agent's secret is sent as `Authorization: Bearer <secret>`; dynamic variables travel in the request extra-body.

## Target architecture

### Backend
1. **`app/api/llm/chat/completions/route.ts`** (new) — the ElevenLabs-facing brain
   front door. `runtime="nodejs"`, `maxDuration=60`. POST: authenticate by
   comparing the `Authorization: Bearer <token>` (or `x-shared-secret`) against
   `SHARED_SECRET`; resolve `session_id` via a tolerant `findSessionId` (checks
   `body.session_id`, `body.elevenlabs_extra_body?.session_id`,
   `body.system__session_id`, and `body.dynamic_variables?.session_id`); UUID-validate
   (400), `getSession` (404); then `return interviewTurnResponse({ sessionId,
   company, messages: parseMessages(body), signal })`. Reuses `lib/brain.ts`.
   - Putting the route at `…/api/llm/chat/completions` makes it robust to ElevenLabs'
     URL convention: set the agent's "Server URL" to `…/api/llm` (ElevenLabs appends
     `/chat/completions`) **or** to the full path — both resolve here.
   - Auth widening lives in this route only; existing `/api/llm` and `/api/chat`
     are unchanged.
2. **`app/api/elevenlabs/token/route.ts`** (new) — `GET`: calls the ElevenLabs token
   endpoint with `ELEVENLABS_API_KEY` + `ELEVENLABS_AGENT_ID`, returns `{ token }`.
   500 if env missing; 502 on ElevenLabs error. Key stays server-side.
3. **`scripts/setup-agent.ts`** (`npm run setup:agent`) — creates/updates an ElevenLabs
   agent via API: custom-LLM URL = `${PUBLIC_URL}/api/llm`, secret = `SHARED_SECRET`,
   `session_id` declared as a dynamic variable forwarded to the custom LLM, a short
   interviewer first-message/system (our brain owns the real prompt), token limit
   ~5000. Prints the `agent_id` to put in `ELEVENLABS_AGENT_ID`. Requires
   `ELEVENLABS_API_KEY` + `PUBLIC_URL`. (If the agent API shape is uncertain at build
   time, the script is best-effort and the dashboard remains the documented fallback.)

### Frontend — `app/interview/[sessionId]/page.tsx` (replace text UI)
- `"use client"`. Wrap in `ConversationProvider`; inner component uses `useConversation`.
- **Pre-call screen:** a "Start interview" button (mic permission is requested on
  click via `getUserMedia`, then `startSession`). This satisfies the browser
  user-gesture + mic-permission requirement.
- **Start:** `GET /api/elevenlabs/token` → `startSession({ conversationToken: token,
  dynamicVariables: { session_id: sessionId } })`. The `session_id` dynamic variable
  is what flows to our custom LLM so RAG scopes correctly.
- **In-call UI (voice-only):**
  - **Orb:** a centered circle that pulses with audio. Drive scale/opacity from
    `getOutputByteFrequencyData()` (avg amplitude) on a `requestAnimationFrame` loop;
    color/active state from `isSpeaking` vs `isListening`.
  - **Captions:** subscribe via `onMessage`; keep the latest **agent** message; render
    it under the orb **only while `isSpeaking`** (clear when the agent stops). No user
    text shown, no input box.
  - **Controls:** mic mute (`isMuted`/`setMuted`) and **End interview**.
- **End:** `endSession()` → `POST /api/report` → `router.push(/report/${sessionId})`,
  with a "generating report…" state.
- Errors (token fetch fail, mic denied, connection error via `onError`) show an
  inline message and return to the pre-call state.
- Transcript persistence is automatic: our brain is the LLM, so it logs each turn
  to libSQL exactly as before — the report still has the transcript.

### Env (`.env` + `.env.example`)
- `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `PUBLIC_URL` (for setup-agent).
- (Existing: `SHARED_SECRET`, `OPENROUTER_*`, `PINECONE_*`, `DATABASE_*`.)

### Deploy (Vercel)
- Next.js auto-detected; no custom `vercel.json` needed. The DB + brain routes use
  `runtime="nodejs"` (already set) — required for `@libsql/client` + streaming.
- Document in `README.md` a **Deploy** section: push to GitHub → import in Vercel →
  set all env vars (`DATABASE_URL`/`DATABASE_AUTH_TOKEN`, `OPENROUTER_*`,
  `PINECONE_*`, `SHARED_SECRET`, `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`) → deploy
  → run `setup:agent` with `PUBLIC_URL=https://<vercel-url>` → paste the printed
  `ELEVENLABS_AGENT_ID` back into Vercel env → redeploy. Confirm `/api/llm/chat/completions`
  is reachable publicly.

## Verification

**What I can verify (and gate on):**
- `npx tsc --noEmit`, `npm run lint`, `npm run build` (type-checks the new routes +
  voice page).
- The existing 5 smokes still pass (the new code doesn't touch their paths; quick regression).
- `scripts/elevenlabs-token-smoke.ts` (`npm run check:token`) — unit test of the token
  route with a **mocked `fetch`**: asserts it calls the ElevenLabs URL with the
  `xi-api-key` header + `agent_id`, returns `{token}`, and 500s when env is missing.
  (No network, no ElevenLabs account needed.)

**What only the user can verify (inherent — I can't speak into a headless mic):**
- The real voice round-trip after deploy: mic → spoken question grounded in the CV →
  spoken answer → follow-up → End → report. A precise manual checklist will be in the
  README. The load-bearing thing to confirm there is **RAG grounding** (the
  interviewer references the actual CV), which proves `session_id` reached the brain.

## Risks / notes

- **`session_id` plumbing is the one real risk** (and the gate for RAG). Mitigation:
  `findSessionId` accepts every plausible location; the manual check explicitly
  verifies grounding; if it ever arrives empty, the brain falls back to a generic
  query (still works, just ungrounded) — so it degrades, not crashes.
- **Custom-LLM auth header:** ElevenLabs sends the secret as `Authorization: Bearer`;
  the new route accepts that (and `x-shared-secret`) — verified by reading the route,
  confirmed live by the user.
- **Agent-creation API shape** may differ; the setup script is best-effort with the
  dashboard as the documented fallback — does not block the deploy.
- **I cannot end-to-end test voice.** Everything I build is verified by build/lint +
  the token unit test; the spoken round-trip is the user's manual step post-deploy.
  This is inherent to ElevenLabs voice, stated plainly.
