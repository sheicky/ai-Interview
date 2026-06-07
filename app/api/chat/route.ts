/**
 * POST /api/chat — browser-facing interview turn. Session-scoped (valid UUID +
 * existing session), no shared secret (mirrors /api/sessions, /api/report).
 * Returns the same OpenAI SSE the ElevenLabs path uses; the client parses it.
 */
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/db";
import { interviewTurnResponse, parseMessages } from "@/lib/brain";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { session_id?: unknown } | null;
  if (!body) return Response.json({ error: "invalid JSON body" }, { status: 400 });

  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  if (!UUID_RE.test(sessionId)) {
    return Response.json({ error: "missing or invalid session_id" }, { status: 400 });
  }

  const session = await getSession(sessionId);
  if (!session) return Response.json({ error: "unknown session" }, { status: 404 });

  return interviewTurnResponse({
    sessionId,
    company: session.company,
    role: session.role ?? undefined,
    messages: parseMessages(body),
    signal: req.signal,
  });
}
