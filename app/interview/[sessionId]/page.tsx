"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function InterviewPage() {
  return (
    <ConversationProvider>
      <VoiceInterview />
    </ConversationProvider>
  );
}

type Phase = "idle" | "connecting" | "live" | "ending";

function VoiceInterview() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("idle");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);

  const conversation = useConversation({
    onMessage: ({ message, source }) => {
      // Captions only for the interviewer (agent) — ignore user transcriptions.
      if (source !== "user") setCaption(message);
    },
    onError: () => setError("Connection error. Please try again."),
  });

  const { status, isSpeaking, isMuted, setMuted } = conversation;

  async function start() {
    setError(null);
    setPhase("connecting");
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const res = await fetch("/api/elevenlabs/token");
      if (!res.ok) {
        setError("Couldn't start the interview. Check the server configuration.");
        setPhase("idle");
        return;
      }
      const { token } = (await res.json()) as { token: string };
      // Fetch the role so the agent's opening can name the specific position
      // (substituted into the first message via the {{role}} dynamic variable).
      const meta = (await fetch(`/api/sessions/${sessionId}`)
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}))) as { role?: string };
      const role = meta.role?.trim() || "open";
      await conversation.startSession({
        conversationToken: token,
        // dynamicVariables feed prompt substitution (e.g. {{role}} in the first
        // message); customLlmExtraBody is what ElevenLabs merges into the POST
        // body to our custom LLM, so the brain resolves the session for RAG.
        dynamicVariables: { session_id: sessionId, role },
        customLlmExtraBody: { session_id: sessionId },
      });
      setPhase("live");
    } catch {
      setError("Microphone access is required to start the interview.");
      setPhase("idle");
    }
  }

  async function end() {
    setPhase("ending");
    try {
      await conversation.endSession();
    } catch {
      /* ignore */
    }
    // Hand off to the report page, which generates the report on demand (with a
    // loading state + retry). We deliberately don't hold the slow generation
    // request open on this tab — that's what was timing out and losing reports.
    router.push(`/report/${sessionId}`);
  }

  // Orb pulse: drive scale from the agent's output audio level while live.
  const orbRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase !== "live") return;
    let raf = 0;
    const tick = () => {
      let level = 0;
      const data = conversation.getOutputByteFrequencyData?.();
      if (data && data.length) {
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        level = sum / data.length / 255;
      }
      if (orbRef.current) {
        orbRef.current.style.transform = `scale(${(1 + level * 0.6).toFixed(3)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, conversation]);

  return (
    <main style={s.main}>
      {phase === "idle" || phase === "connecting" ? (
        <div style={s.center}>
          <h1 style={s.h1}>Your interview</h1>
          <p style={s.sub}>You&apos;ll speak with an AI interviewer. Find a quiet spot.</p>
          <button onClick={start} disabled={phase === "connecting"} style={s.startBtn}>
            {phase === "connecting" ? "Connecting…" : "Start interview"}
          </button>
          {error && <p role="alert" style={s.error}>{error}</p>}
        </div>
      ) : (
        <div style={s.center}>
          <div style={s.orbWrap}>
            <div style={s.halo} aria-hidden />
            <div
              ref={orbRef}
              style={{
                ...s.orb,
                background: isSpeaking
                  ? "radial-gradient(circle at 34% 28%, #ffffff, #ffe3cc 52%, #ff9cdf 100%)"
                  : "radial-gradient(circle at 34% 28%, #fff6ee, #ffd9c2 60%, #fbb38b 100%)",
                boxShadow: isSpeaking
                  ? "0 0 90px 10px rgba(255,255,255,0.6)"
                  : "0 0 54px 6px rgba(255,255,255,0.4)",
              }}
            />
          </div>
          <p style={s.state}>
            {status !== "connected" ? "Connecting…" : isSpeaking ? "Interviewer speaking…" : "Listening…"}
          </p>
          <p style={s.caption}>{isSpeaking ? caption : ""}</p>
          <div style={s.controls}>
            <button onClick={() => setMuted(!isMuted)} style={s.muteBtn}>
              {isMuted ? "Unmute" : "Mute"}
            </button>
            <button onClick={end} disabled={phase === "ending"} style={s.endBtn}>
              {phase === "ending" ? "Generating report…" : "End interview"}
            </button>
          </div>
          {error && <p role="alert" style={s.error}>{error}</p>}
        </div>
      )}
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: 24,
    color: "#2a1622",
    background:
      "radial-gradient(60% 50% at 50% 40%, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 70%), linear-gradient(135deg, #ff9cdf 0%, #fb8144 100%)",
  },
  center: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 18,
    textAlign: "center",
    maxWidth: 560,
  },
  h1: { fontSize: 30, letterSpacing: "-0.02em", fontWeight: 600, margin: 0 },
  sub: { color: "rgba(42,22,34,0.72)", margin: 0, fontSize: 15, lineHeight: 1.55 },
  startBtn: {
    background: "#1a1014",
    color: "#fff",
    border: "none",
    borderRadius: 999,
    padding: "15px 34px",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 6,
  },
  orbWrap: { position: "relative", height: 260, width: 260, display: "grid", placeItems: "center" },
  halo: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 68%)",
  },
  orb: {
    width: 150,
    height: 150,
    borderRadius: "50%",
    transition: "background 0.25s ease, box-shadow 0.25s ease, transform 0.08s linear",
  },
  state: {
    color: "rgba(42,22,34,0.65)",
    margin: 0,
    fontSize: 13,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  caption: { minHeight: 56, fontSize: 19, lineHeight: 1.45, margin: 0, maxWidth: 520, color: "#2a1622", fontWeight: 500 },
  controls: { display: "flex", gap: 12, marginTop: 10 },
  muteBtn: {
    background: "rgba(255,255,255,0.6)",
    color: "#2a1622",
    border: "1px solid rgba(42,22,34,0.16)",
    borderRadius: 999,
    padding: "11px 22px",
    fontWeight: 600,
    cursor: "pointer",
  },
  endBtn: {
    background: "#1a1014",
    color: "#fff",
    border: "none",
    borderRadius: 999,
    padding: "11px 22px",
    fontWeight: 600,
    cursor: "pointer",
  },
  error: { color: "#7a1410", fontSize: 14 },
};
