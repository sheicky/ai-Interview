# System Design — AI Interview

Voice AI that runs a real, role-specific interview from a CV + job description, then produces a scored report.

> **Tip:** every diagram below is Mermaid. To get it into Excalidraw: open Excalidraw → menu → **"Mermaid to Excalidraw"** → paste one fenced `mermaid` block.

**Stack:** Next.js 16 (App Router, `nodejs` runtime) on Vercel · Turso (libSQL) · Pinecone (integrated index) · OpenRouter (→ Anthropic) · ElevenLabs Conversational AI (WebRTC voice + custom LLM).

---

## 1. High-level architecture

```mermaid
flowchart TB
  subgraph Client["Browser (Next.js client)"]
    Intake["Intake form<br/>/"]
    Interview["Interview screen<br/>/interview/:id<br/>ElevenLabs WebRTC + orb"]
    Report["Report screen<br/>/report/:id<br/>+ Download PDF"]
    Admin["Admin<br/>/admin (code gate)"]
  end

  subgraph Vercel["Vercel — Next.js server (runtime=nodejs)"]
    direction TB
    SessAPI["POST /api/sessions<br/>create + index"]
    SessGet["GET /api/sessions/:id<br/>role + company"]
    TokAPI["GET /api/elevenlabs/token<br/>mint WebRTC token"]
    LlmAPI["POST /api/llm<br/>POST /api/llm/chat/completions<br/>(custom-LLM brain, shared secret)"]
    ChatAPI["POST /api/chat<br/>(browser brain, session-scoped)"]
    RepAPI["POST/GET /api/report"]
    Login["/admin login server action<br/>(httpOnly cookie)"]

    subgraph Lib["lib/ (shared logic)"]
      Brain["brain.ts<br/>interviewTurnResponse"]
      Interviewer["interviewer.ts<br/>buildSystemPrompt"]
      Rag["rag.ts (Pinecone)"]
      Llm["llm.ts (OpenRouter SDK)"]
      Db["db.ts (libSQL)"]
      ReportLib["report.ts"]
      Cv["cv.ts (unpdf)"]
      Scrape["scrape.ts"]
      Metrics["metrics.ts"]
    end
  end

  subgraph External["External services"]
    EL["ElevenLabs<br/>Conversational AI"]
    OR["OpenRouter<br/>→ anthropic/claude-sonnet-4.6"]
    PC[("Pinecone<br/>namespace per session")]
    TU[("Turso / libSQL<br/>sessions · turns · reports")]
  end

  Intake -->|"multipart: cv,jd,role,company,url"| SessAPI
  Interview -->|"GET token"| TokAPI
  Interview -->|"GET role"| SessGet
  Report -->|"POST generate / GET"| RepAPI
  Admin --> Login

  SessAPI --> Cv --> SessAPI
  SessAPI --> Scrape
  SessAPI --> Db
  SessAPI --> Rag
  TokAPI -->|"xi-api-key"| EL
  EL -->|"custom LLM callback<br/>x-shared-secret + session_id"| LlmAPI
  LlmAPI --> Brain
  ChatAPI --> Brain
  Brain --> Rag --> PC
  Brain --> Interviewer
  Brain --> Llm --> OR
  Brain --> Db
  RepAPI --> Db
  RepAPI --> Llm
  Login --> Db
  Admin --> Metrics --> Db
  Db --- TU

  Interview <-->|"WebRTC audio (mic + TTS)"| EL
```

---

## 2. Voice interview — one turn (the core loop)

The browser never talks to the LLM directly. ElevenLabs handles speech↔text and calls **our** endpoint as its "custom LLM"; our brain grounds each turn in Pinecone and streams an OpenAI-compatible reply back.

```mermaid
sequenceDiagram
  autonumber
  participant U as Candidate
  participant B as Browser /interview
  participant T as GET /api/elevenlabs/token
  participant EL as ElevenLabs
  participant L as POST /api/llm/chat/completions
  participant R as lib_rag Pinecone
  participant O as OpenRouter → Claude
  participant D as Turso

  B->>T: GET token
  T->>EL: GET conversation/token (xi-api-key + agent_id)
  EL-->>B: WebRTC conversationToken
  B->>EL: startSession(token,<br/>dynamicVariables{session_id,role},<br/>customLlmExtraBody{session_id})
  EL-->>U: speaks first_message (names {{role}} + explains structure)
  U-->>EL: speaks an answer
  EL->>EL: ASR → transcript
  EL->>L: POST /chat/completions<br/>(x-shared-secret, custom_llm_extra_body.session_id, messages)
  L->>L: auth + UUID-validate session_id
  L->>D: getSession(id) → 404 if unknown
  L->>R: retrieve(query, session_id) top-k
  R-->>L: CV / JD / company chunks
  L->>O: stream chat completion (system prompt + history)
  O-->>L: token stream
  L-->>EL: OpenAI SSE chunks + [DONE]
  EL-->>U: TTS speaks the reply
  L->>D: addTurn(user) + addTurn(assistant)
  Note over EL,L: cascade_timeout_seconds = 15 (must beat cold start + retrieve + TTFT)
```

---

## 3. Intake — create session + index documents

```mermaid
sequenceDiagram
  autonumber
  participant U as Candidate
  participant F as Intake form
  participant S as POST /api/sessions
  participant CV as lib_cv unpdf
  participant SC as lib/scrape
  participant D as Turso
  participant PC as Pinecone

  U->>F: CV (PDF) + JD + role + company + url
  F->>S: multipart/form-data
  S->>S: validate (cv, jd, role, company)
  S->>CV: parseCvPdf(bytes) → text
  S->>SC: scrapeCompany(url) (best-effort)
  S->>D: createSession(id, company, url, role)
  S->>PC: addSessionDocs([cv, "Role:.."+jd, company])
  alt indexing fails
    S->>PC: deleteSessionDocs(id)
    S->>D: deleteSession(id)
    S-->>F: 500 (rolled back, no orphan)
  else ok
    S-->>F: { session_id, company_scraped }
    F->>U: → /interview/[session_id]
  end
```

---

## 4. Report — generate + view + PDF

```mermaid
sequenceDiagram
  autonumber
  participant U as Candidate
  participant B as Browser /interview
  participant RP as POST /api/report
  participant D as Turso
  participant O as OpenRouter → Claude
  participant V as report server
  participant EL as ElevenLabs

  U->>B: End interview
  B->>EL: endSession()
  B->>RP: POST { session_id }
  RP->>D: getTurns(id)
  alt no turns
    RP-->>B: 422 "no interview to report on"
  else has transcript
    RP->>D: getReport(id) (cache)
    opt not cached or ?force=1
      RP->>O: summarize transcript → fixed-shape JSON
      RP->>D: saveReport(id, json)
    end
    RP-->>B: report JSON
    B->>U: → /report/:id
    U->>V: view
    V->>D: getReport(id) → render
    U->>U: "Download PDF" → window.print() (@media print)
    U->>U: "Take another interview" → /
  end
```

---

## 5. Data model

```mermaid
erDiagram
  SESSIONS ||--o{ TURNS : has
  SESSIONS ||--o| REPORTS : has

  SESSIONS {
    text id PK "uuid"
    text company
    text company_url
    text role
    text created_at
    text status
    text ended_at
  }
  TURNS {
    int id PK
    text session_id FK
    text ts
    text role "user | assistant"
    text text
    text phase
    int latency_ms "TTFT"
  }
  REPORTS {
    text session_id PK
    text created_at
    text json "scored report"
  }
```

**Pinecone** is separate from the relational store: one **namespace per `session_id`** in the integrated index (`interview-docs`, model `multilingual-e5-large`), holding the CV / JD / company chunks. Deleting a session deletes its namespace (`deleteSessionDocs`).

---

## 6. Deployment & trust boundaries

```mermaid
flowchart LR
  subgraph Internet
    User["Candidate browser"]
    Owner["Owner browser"]
  end
  subgraph VercelEdge["Vercel (GitHub-connected, auto-deploy from main)"]
    App["Next.js app<br/>ai-interview-sheickys-projects.vercel.app"]
  end
  ELsrv["ElevenLabs servers"]

  User -->|HTTPS| App
  Owner -->|"HTTPS + /admin code"| App
  User <-->|WebRTC| ELsrv
  ELsrv -->|"HTTPS callback to /api/llm<br/>(x-shared-secret)"| App
  App -->|"libsql:// + auth token"| TU[("Turso")]
  App -->|"API key"| PC[("Pinecone")]
  App -->|"API key"| OR["OpenRouter"]
  App -->|"xi-api-key"| ELsrv
```

**Secrets (env):** `PINECONE_API_KEY`, `PINECONE_INDEX`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `SHARED_SECRET`, `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `ADMIN_CODE`.

**Auth posture:** session-scoped by URL (no login); `/api/llm*` requires `SHARED_SECRET`; `/admin` behind an httpOnly-cookie code gate. Vercel Deployment Protection must stay **off** (ElevenLabs has to reach `/api/llm`).

## 7. Wiring gotchas (load-bearing)
- ElevenLabs agent `custom_llm.url` = **base** `…/api/llm` (it appends `/chat/completions`). Full path → 404.
- `session_id` reaches the brain via **`customLlmExtraBody`** (the POST body), not `dynamicVariables` (prompt substitution only).
- `cascade_timeout_seconds = 15` so the custom LLM beats cold start + Pinecone + first token.
- One Pinecone namespace per session = hard isolation between candidates.

---

## 8. RAG pipeline (minimal — for a quick walkthrough)

The whole loop in one picture: **embed & store → STT → vector search → grounded LLM → TTS.** Pinecone is an *integrated* index, so embedding runs server-side (no embedding model in our code).

```mermaid
flowchart LR
  subgraph Ingest["① Setup — once per interview"]
    Docs["CV + JD (raw)"] --> Parse["PDF → text<br/>(unpdf)"]
    Parse --> PC[("Pinecone integrated index<br/>embed: multilingual-e5-large · 1024-d<br/>cosine · namespace = session_id")]
  end

  subgraph Turn["② Each spoken turn — WebRTC"]
    Mic["Candidate audio"] --> STT["STT / ASR<br/>(ElevenLabs)"]
    STT --> Q["query text"]
    Q --> KNN["ANN vector search<br/>top-k = 5 · cosine<br/>(same namespace)"]
    KNN --> Ctx["retrieved CV / JD chunks"]
    Ctx --> Prompt["system prompt<br/>+ RAG context + history"]
    Prompt --> LLM["LLM, streaming<br/>Claude via OpenRouter<br/>OpenAI-compatible SSE"]
    LLM --> TTS["TTS<br/>(ElevenLabs)"]
    TTS --> Spk["spoken reply"]
  end

  PC -. server-side embed + ANN retrieve .-> KNN
```

**~50s narration:** At setup, the CV and job description are parsed to text and sent to Pinecone, which **embeds** them server-side (`multilingual-e5-large`, 1024-dim, cosine) and stores the vectors in a **per-session namespace**. During the call (over WebRTC), each turn the candidate's audio is transcribed by **STT**; that text is the query for an **approximate-nearest-neighbour search** (top-5) in their namespace; the retrieved CV/JD chunks are injected into the **system prompt** alongside the history; **Claude** streams the next question back as OpenAI-compatible SSE; and **TTS** speaks it — grounded in this exact résumé and role.
