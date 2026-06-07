"use client";

/**
 * Generates the interview report on demand when none is stored yet (the normal
 * path right after an interview ends). Decoupled from the interview tab so the
 * slow ~20-40s generation request isn't racing that page's lifecycle — and a
 * transient failure is recoverable with one click instead of being lost.
 *
 * On success we router.refresh(): the server component re-runs, now finds the
 * stored report, and renders it in place.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Status = "generating" | "error";

export function ReportGenerator({
  sessionId,
  cardStyle,
  btnStyle,
  mutedColor,
}: {
  sessionId: string;
  cardStyle: React.CSSProperties;
  btnStyle: React.CSSProperties;
  mutedColor: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("generating");
  // Guard against React Strict Mode double-invoking the effect in dev.
  const inFlight = useRef(false);

  // Promise-chained (not async/await) so the state updates live in clearly
  // asynchronous .then/.catch callbacks rather than the effect's sync body.
  const generate = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    fetch("/api/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    })
      .then((res) => {
        inFlight.current = false;
        // Report is now stored — re-render the server component to show it.
        if (res.ok) router.refresh();
        else setStatus("error");
      })
      .catch(() => {
        inFlight.current = false;
        setStatus("error");
      });
  }, [sessionId, router]);

  useEffect(() => {
    generate();
  }, [generate]);

  if (status === "error") {
    return (
      <div style={cardStyle}>
        <p style={{ margin: "0 0 12px", lineHeight: 1.55 }}>
          We couldn&apos;t generate your report. This is usually a temporary hiccup.
        </p>
        <button
          type="button"
          onClick={() => {
            setStatus("generating");
            generate();
          }}
          style={btnStyle}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <p style={{ margin: 0, lineHeight: 1.55 }}>
        Scoring your interview<span aria-hidden>…</span>
      </p>
      <p style={{ margin: "6px 0 0", fontSize: 13, color: mutedColor, lineHeight: 1.5 }}>
        This takes up to a minute. You can keep this page open.
      </p>
    </div>
  );
}
