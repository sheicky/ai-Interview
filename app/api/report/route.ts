/**
 * POST /api/report — generate (or return cached) interview report for a session.
 *   1. validate session_id (UUID) + session exists
 *   2. cached unless ?force=1
 *   3. transcript from SQLite + CV/JD from Pinecone → strict-JSON report via OpenRouter
 *   4. parse/validate (one corrective retry), upsert, return JSON
 * GET /api/report?session_id=… — return the stored report (404 if none).
 *
 * Unauthenticated but session-scoped (mirrors /api/sessions): the candidate's
 * browser triggers it at interview end.
 */
import type { NextRequest } from "next/server";
import { retrieve } from "@/lib/rag";
import { getSession, getTurns, getReport, saveReport, type TurnRow } from "@/lib/db";
import { complete } from "@/lib/llm";
import { buildReportPrompt, parseReport, type Report } from "@/lib/report";
import type { Msg } from "@/lib/interviewer";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const body = (await req.json().catch(() => ({}))) as {
    session_id?: unknown;
    force?: unknown;
  };
  const sessionId =
    typeof body.session_id === "string"
      ? body.session_id
      : url.searchParams.get("session_id") ?? "";
  if (!UUID_RE.test(sessionId)) {
    return Response.json({ error: "missing or invalid session_id" }, { status: 400 });
  }

  const session = await getSession(sessionId);
  if (!session) return Response.json({ error: "unknown session" }, { status: 404 });

  const force = url.searchParams.get("force") === "1" || body.force === true;
  if (!force) {
    const existing = await getReport(sessionId);
    if (existing) return Response.json(JSON.parse(existing.json));
  }

  const turns = await getTurns(sessionId);
  if (transcriptIsEmpty(turns)) {
    return Response.json({ error: "no interview to report on" }, { status: 422 });
  }

  let docs: { kind: string; text: string }[];
  try {
    docs = await retrieve(
      "candidate experience, skills, and the role requirements",
      sessionId,
      10,
    );
  } catch (err) {
    console.error("[/report] retrieval failed:", err);
    return Response.json({ error: "retrieval failed" }, { status: 502 });
  }

  const hasCompanyUrl = !!session.company_url;
  const messages = buildReportPrompt({
    company: session.company,
    hasCompanyUrl,
    transcript: turns,
    docs,
  });

  let report: Report;
  try {
    report = await generate(messages, hasCompanyUrl);
  } catch (err) {
    console.error("[/report] generation failed:", err);
    return Response.json({ error: "could not generate report" }, { status: 502 });
  }

  // Don't lose a just-generated (paid-for) report if the cache write fails.
  try {
    await saveReport(sessionId, JSON.stringify(report));
  } catch (err) {
    console.error("[/report] saveReport failed:", err);
  }
  return Response.json(report);
}

export async function GET(req: NextRequest): Promise<Response> {
  const sessionId = new URL(req.url).searchParams.get("session_id") ?? "";
  if (!UUID_RE.test(sessionId)) {
    return Response.json({ error: "missing or invalid session_id" }, { status: 400 });
  }
  const row = await getReport(sessionId);
  if (!row) return Response.json({ error: "no report" }, { status: 404 });
  return Response.json(JSON.parse(row.json));
}

/** A transcript with no non-empty user/assistant text can't be reported on. */
function transcriptIsEmpty(turns: TurnRow[]): boolean {
  return !turns.some(
    (t) => (t.role === "user" || t.role === "assistant") && t.text && t.text.trim(),
  );
}

/** Generate + parse, with one corrective retry if the model returns bad JSON. */
async function generate(messages: Msg[], hasCompanyUrl: boolean): Promise<Report> {
  const first = await complete(messages);
  try {
    return parseReport(first, hasCompanyUrl);
  } catch {
    const corrective: Msg = {
      role: "user",
      content:
        "Your previous response was not valid JSON. Respond with ONLY the JSON object — no prose, no code fences.",
    };
    const second = await complete([...messages, corrective]);
    return parseReport(second, hasCompanyUrl);
  }
}
