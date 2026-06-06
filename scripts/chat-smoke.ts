/**
 * Real round-trip for the browser chat endpoint. Run:
 *   npm run check:chat
 * Requires OPENROUTER_API_KEY, OPENROUTER_MODEL, PINECONE_API_KEY, PINECONE_INDEX.
 */
import { randomUUID } from "node:crypto";
import { strict as assert } from "node:assert";
import { NextRequest } from "next/server";
import { createSession, deleteSession } from "../lib/db";
import { addSessionDocs, deleteSessionDocs } from "../lib/rag";

function ok(name: string) {
  console.log(`✓ ${name}`);
}

function chatReq(payload: unknown) {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function readSse(res: Response): Promise<string> {
  const text = await res.text();
  let out = "";
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") continue;
    try {
      out += JSON.parse(payload).choices?.[0]?.delta?.content ?? "";
    } catch {
      /* ignore */
    }
  }
  return out;
}

async function main() {
  const { POST } = await import("../app/api/chat/route");

  assert.equal((await POST(chatReq({ session_id: "nope", messages: [] }))).status, 400);
  ok("bad session_id → 400");

  assert.equal((await POST(chatReq({ session_id: randomUUID(), messages: [] }))).status, 404);
  ok("unknown session → 404");

  const sid = randomUUID();
  try {
    createSession({ id: sid, company: "Acme Corp" });
    await addSessionDocs(sid, [
      { kind: "cv", text: "Jane Doe led the billing rewrite at Acme; 8 years backend." },
      { kind: "jd", text: "Senior backend engineer for the billing platform." },
    ]);

    const res = await POST(chatReq({ session_id: sid, messages: [{ role: "user", content: "Hi, I'm ready." }] }));
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    const reply = await readSse(res);
    assert.ok(reply.trim().length > 0, "interviewer reply must be non-empty");
    ok("POST /api/chat streams a non-empty interviewer turn");
    console.log(`  reply: ${reply.slice(0, 160)}${reply.length > 160 ? "…" : ""}`);

    console.log("\nALL CHAT SMOKE CHECKS PASSED");
  } finally {
    await deleteSessionDocs(sid).catch(() => {});
    try {
      deleteSession(sid);
    } catch {
      /* best-effort */
    }
  }
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err);
  process.exit(1);
});
