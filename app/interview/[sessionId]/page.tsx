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
      await conversation.startSession({
        conversationToken: token,
        // dynamicVariables feed prompt substitution; customLlmExtraBody is what
        // ElevenLabs merges into the POST body sent to our custom LLM, so the
        // brain can resolve the session and ground the interview in Pinecone.
        dynamicVariables: { session_id: sessionId },
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
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (!res.ok) {
        setError("Could not generate the report.");
        setPhase("live");
        return;
      }
      router.push(`/report/${sessionId}`);
    } catch {
      setError("Could not generate the report.");
      setPhase("live");
    }
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
                  ? "radial-gradient(circle at 35% 30%, #9cc0ff, #2f6df6 60%, #1d4ed8)"
                  : "radial-gradient(circle at 35% 30%, #6f8bd6, #2f4ea8 65%, #243a73)",
                boxShadow: isSpeaking
                  ? "0 0 80px 8px rgba(47,109,246,0.55)"
                  : "0 0 48px 4px rgba(47,109,246,0.25)",
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
    color: "#e8eaf1",
    background:
      "radial-gradient(115% 75% at 50% 30%, #1a2236 0%, #0e1320 48%, #080a12 100%)",
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
  sub: { color: "#9aa3b8", margin: 0, fontSize: 15, lineHeight: 1.55 },
  startBtn: {
    background: "var(--accent)",
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
    background: "radial-gradient(circle, rgba(47,109,246,0.18) 0%, rgba(47,109,246,0) 68%)",
  },
  orb: {
    width: 150,
    height: 150,
    borderRadius: "50%",
    transition: "background 0.25s ease, box-shadow 0.25s ease, transform 0.08s linear",
  },
  state: {
    color: "#9aa3b8",
    margin: 0,
    fontSize: 13,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  caption: { minHeight: 56, fontSize: 19, lineHeight: 1.45, margin: 0, maxWidth: 520, color: "#f1f3f9" },
  controls: { display: "flex", gap: 12, marginTop: 10 },
  muteBtn: {
    background: "rgba(255,255,255,0.08)",
    color: "#e8eaf1",
    border: "1px solid rgba(255,255,255,0.16)",
    borderRadius: 999,
    padding: "11px 22px",
    fontWeight: 600,
    cursor: "pointer",
  },
  endBtn: {
    background: "#e0564f",
    color: "#fff",
    border: "none",
    borderRadius: 999,
    padding: "11px 22px",
    fontWeight: 600,
    cursor: "pointer",
  },
  error: { color: "#ff9b9b", fontSize: 14 },
};
