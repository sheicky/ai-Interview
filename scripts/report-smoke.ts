/**
 * Real round-trip for the interview report. Run:
 *   npm run check:report
 * Requires OPENROUTER_API_KEY, OPENROUTER_MODEL, PINECONE_API_KEY,
 * PINECONE_INDEX in the environment (.env).
 */
import { randomUUID } from "node:crypto";
import { strict as assert } from "node:assert";
import { NextRequest } from "next/server";
import { createSession, deleteSession, addTurn, getReport, deleteReport } from "../lib/db";
import { addSessionDocs, deleteSessionDocs } from "../lib/rag";
import { transcriptToText, parseReport } from "../lib/report";

function ok(name: string) {
  console.log(`✓ ${name}`);
}

function reportReq(sid: string, force = false) {
  const u = `http://localhost/api/report${force ? "?force=1" : ""}`;
  return new NextRequest(u, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id: sid }),
  });
}

async function main() {
  // --- pure helpers ---
  assert.equal(
    transcriptToText([
      { id: 1, session_id: "x", ts: "", role: "assistant", text: "Hi", phase: null, latency_ms: null },
      { id: 2, session_id: "x", ts: "", role: "user", text: "Hello", phase: null, latency_ms: null },
    ]),
    "Interviewer: Hi\nCandidate: Hello",
  );
  const parsed = parseReport(
    '```json\n{"overall":{"score":150,"band":"strong","verdict":"v"},"areas":{"technical":{"score":80,"comment":"c"},"communication":{"score":70,"comment":"c"},"role_fit":{"score":60,"comment":"c"},"company_fit":null}}\n```',
    false,
  );
  assert.equal(parsed.overall.score, 100, "score clamps to 100");
  assert.equal(parsed.areas.company_fit, null, "company_fit null when no url");
  assert.deepEqual(parsed.strengths, [], "missing arrays default to []");
  assert.throws(() => parseReport("not json", false), "malformed JSON throws");
  ok("pure report helpers behave");

  const { POST } = await import("../app/api/report/route");

  const sid = randomUUID();
  const emptySid = randomUUID();
  try {
    createSession({ id: sid, company: "Acme Corp", companyUrl: "https://acme.example" });
    await addSessionDocs(sid, [
      { kind: "cv", text: "Jane Doe led the billing rewrite at Acme; 8 years backend, payments." },
      { kind: "jd", text: "Senior backend engineer for the billing platform; payments + scaling." },
    ]);
    addTurn({ sessionId: sid, role: "assistant", text: "Walk me through the billing rewrite you led." });
    addTurn({ sessionId: sid, role: "user", text: "I split the monolith's billing into a service, introduced idempotency keys, and cut failed charges by 30%." });
    addTurn({ sessionId: sid, role: "assistant", text: "How did you handle retries safely?" });
    addTurn({ sessionId: sid, role: "user", text: "Idempotency keys plus an outbox so retries never double-charge." });

    const res = await POST(reportReq(sid));
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    const report = await res.json();
    assert.ok(report.overall && Number.isInteger(report.overall.score), "overall.score is an integer");
    assert.ok(report.overall.score >= 0 && report.overall.score <= 100, "overall.score in range");
    for (const k of ["technical", "communication", "role_fit"]) {
      assert.ok(report.areas[k] && typeof report.areas[k].score === "number", `area ${k} scored`);
    }
    assert.ok(report.areas.company_fit && typeof report.areas.company_fit.score === "number", "company_fit scored (url present)");
    assert.ok(Array.isArray(report.strengths) && report.strengths.length > 0, "strengths non-empty");
    ok("POST /api/report returns a valid fixed-shape report");
    console.log(`  overall: ${report.overall.score} (${report.overall.band}) — ${report.overall.verdict}`);

    // Cache: a second non-forced call returns the identical stored report.
    const cached = await (await POST(reportReq(sid))).json();
    assert.deepEqual(cached, report, "second call returns the cached report");
    ok("report is cached");

    // Force regenerates (valid shape; content may differ).
    const forced = await POST(reportReq(sid, true));
    assert.equal(forced.status, 200, "force returns 200");
    const forcedReport = await forced.json();
    assert.ok(forcedReport.overall && Number.isInteger(forcedReport.overall.score), "forced report valid");
    ok("?force=1 regenerates");

    // Empty transcript → 422.
    createSession({ id: emptySid, company: "Empty Co" });
    assert.equal((await POST(reportReq(emptySid))).status, 422, "empty transcript → 422");
    ok("empty transcript is rejected (422)");

    console.log("\nALL REPORT SMOKE CHECKS PASSED");
  } finally {
    await deleteSessionDocs(sid).catch(() => {});
    for (const id of [sid, emptySid]) {
      try { deleteReport(id); } catch { /* best-effort */ }
      try { deleteSession(id); } catch { /* best-effort */ }
    }
  }
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err);
  process.exit(1);
});
