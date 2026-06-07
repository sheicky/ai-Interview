/**
 * POST /api/llm/chat/completions — ElevenLabs custom-LLM front door.
 * ElevenLabs sends the agent secret as `Authorization: Bearer <secret>` and calls
 * `<server-url>/chat/completions`. We accept that (or x-shared-secret), resolve the
 * session_id ElevenLabs forwards (dynamic variable / extra-body), and delegate to
 * the shared brain so the voice interview is RAG-grounded just like the text path.
 */
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/db";
import { interviewTurnResponse, parseMessages } from "@/lib/brain";

export const runtime = "nodejs";
export const maxDuration = 60;

const SHARED_SECRET = process.env.SHARED_SECRET ?? "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isAuthed(req: NextRequest): boolean {
  if (!SHARED_SECRET) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.replace(/^Bearer\s+/i, "").trim() === SHARED_SECRET) return true;
  if ((req.headers.get("x-shared-secret") ?? "") === SHARED_SECRET) return true;
  return false;
}

/** ElevenLabs may forward session_id via dynamic variables / extra-body — check all known spots. */
function findSessionId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const fromObj = (o: unknown): string | null => {
    if (o && typeof o === "object") {
      const v = (o as Record<string, unknown>).session_id;
      if (typeof v === "string") return v;
    }
    return null;
  };
  if (typeof b.session_id === "string") return b.session_id;
  return (
    fromObj(b.custom_llm_extra_body) ??
    fromObj(b.elevenlabs_extra_body) ??
    fromObj(b.dynamic_variables) ??
    (typeof b.system__session_id === "string" ? b.system__session_id : null)
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!isAuthed(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body: unknown = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "invalid JSON body" }, { status: 400 });

  const sessionId = findSessionId(body);
  if (!sessionId || !UUID_RE.test(sessionId)) {
    return Response.json({ error: "missing or invalid session_id" }, { status: 400 });
  }

  const session = await getSession(sessionId);
  if (!session) return Response.json({ error: "unknown session" }, { status: 404 });

  return interviewTurnResponse({
    sessionId,
    company: session.company,
    messages: parseMessages(body),
    signal: req.signal,
  });
}
