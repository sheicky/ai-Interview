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
        dynamicVariables: { session_id: sessionId },
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
            <div
              ref={orbRef}
              style={{ ...s.orb, background: isSpeaking ? "#2563eb" : "#93c5fd" }}
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
  main: { minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "system-ui, sans-serif", color: "#1a1a1a", background: "#fafafa" },
  center: { display: "flex", flexDirection: "column", alignItems: "center", gap: 16, textAlign: "center", maxWidth: 560 },
  h1: { fontSize: 26, margin: 0 },
  sub: { color: "#6b7280", margin: 0 },
  startBtn: { background: "#2563eb", color: "#fff", border: "none", borderRadius: 999, padding: "14px 28px", fontSize: 16, fontWeight: 600, cursor: "pointer" },
  orbWrap: { height: 220, display: "grid", placeItems: "center" },
  orb: { width: 140, height: 140, borderRadius: "50%", transition: "background 0.2s ease", boxShadow: "0 12px 40px rgba(37,99,235,0.35)" },
  state: { color: "#6b7280", margin: 0, fontSize: 14 },
  caption: { minHeight: 48, fontSize: 18, lineHeight: 1.4, margin: 0, maxWidth: 520 },
  controls: { display: "flex", gap: 12, marginTop: 8 },
  muteBtn: { background: "#e5e7eb", color: "#1a1a1a", border: "none", borderRadius: 999, padding: "10px 20px", fontWeight: 600, cursor: "pointer" },
  endBtn: { background: "#ef4444", color: "#fff", border: "none", borderRadius: 999, padding: "10px 20px", fontWeight: 600, cursor: "pointer" },
  error: { color: "#dc2626", fontSize: 14 },
};
