/**
 * GET /api/sessions/[sessionId] — minimal public session metadata for the
 * interview client (role + company), so the ElevenLabs first message can name
 * the specific role via a dynamic variable. Session-scoped by the URL, no secret.
 */
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/db";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const { sessionId } = await params;
  if (!UUID_RE.test(sessionId)) {
    return Response.json({ error: "invalid session" }, { status: 400 });
  }
  const session = await getSession(sessionId);
  if (!session) return Response.json({ error: "unknown session" }, { status: 404 });
  return Response.json({ role: session.role ?? "", company: session.company });
}
