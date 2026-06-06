/**
 * Real round-trip for the interview brain. Run:
 *   npm run check:brain
 * Requires OPENROUTER_API_KEY, OPENROUTER_MODEL, PINECONE_API_KEY,
 * PINECONE_INDEX, and SHARED_SECRET in the environment (.env).
 *
 * Seeds a throwaway session, POSTs an OpenAI-format request to the route, reads
 * the streamed reply, and asserts a non-empty interviewer turn comes back.
 */
import { randomUUID } from "node:crypto";
import { strict as assert } from "node:assert";
import { NextRequest } from "next/server";
import { createSession, deleteSession } from "../lib/db";
import { addSessionDocs, deleteSessionDocs, retrieve } from "../lib/rag";
import {
  buildSystemPrompt,
  phaseForTurn,
  latestUserText,
  sanitizeHistory,
} from "../lib/interviewer";
import { POST } from "../app/api/llm/route";

function ok(name: string) {
  console.log(`✓ ${name}`);
}

/** Read an SSE Response body and concatenate the assistant delta content. */
async function readSse(res: Response): Promise<string> {
  const text = await res.text();
  let out = "";
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") continue;
    try {
      const json = JSON.parse(payload);
      out += json.choices?.[0]?.delta?.content ?? "";
    } catch {
      /* ignore non-JSON keepalive lines */
    }
  }
  return out;
}

async function main() {
  // --- pure helpers ---
  assert.equal(phaseForTurn(0), "intro");
  assert.equal(phaseForTurn(99), "wrap_up");
  assert.equal(latestUserText([{ role: "user", content: "hi" }]), "hi");
  assert.equal(sanitizeHistory([{ role: "system", content: "x" }]).length, 1);
  assert.ok(buildSystemPrompt({ docs: [] }).includes("<reference>"));
  ok("pure interviewer helpers behave");

  const secret = process.env.SHARED_SECRET;
  assert.ok(secret, "SHARED_SECRET must be set in .env");

  const sid = randomUUID();
  try {
    await createSession({ id: sid, company: "Acme Corp" });
    await addSessionDocs(sid, [
      { kind: "cv", text: "Jane Doe led the billing rewrite at Acme and scaled payments to 10x volume." },
      { kind: "jd", text: "Hiring a senior backend engineer for the billing platform; needs payments experience." },
    ]);

    // Pinecone is eventually consistent — wait until the docs are retrievable so
    // the grounding observation is meaningful.
    for (let i = 0; i < 12; i++) {
      if ((await retrieve("billing payments", sid)).length > 0) break;
      await new Promise((r) => setTimeout(r, 1500));
    }

    const reqBody = {
      messages: [{ role: "user", content: "Hi, I'm ready to start." }],
      session_id: sid,
    };
    const req = new NextRequest("http://localhost/api/llm", {
      method: "POST",
      headers: { "content-type": "application/json", "x-shared-secret": secret },
      body: JSON.stringify(reqBody),
    });

    const res = await POST(req);
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    const reply = await readSse(res);
    assert.ok(reply.trim().length > 0, "interviewer reply must be non-empty");
    ok("POST /api/llm streams a non-empty interviewer turn");
    console.log(`  reply: ${reply.slice(0, 160)}${reply.length > 160 ? "…" : ""}`);
    console.log(
      `  grounding: reply ${/acme|billing|payments/i.test(reply) ? "DOES" : "does not"} mention seeded CV details`,
    );

    // Auth gate: wrong secret must 401.
    const badReq = new NextRequest("http://localhost/api/llm", {
      method: "POST",
      headers: { "content-type": "application/json", "x-shared-secret": "wrong" },
      body: JSON.stringify(reqBody),
    });
    assert.equal((await POST(badReq)).status, 401, "bad secret must 401");
    ok("bad shared secret is rejected");

    console.log("\nALL BRAIN SMOKE CHECKS PASSED");
  } finally {
    await deleteSessionDocs(sid).catch(() => {});
    try {
      await deleteSession(sid);
    } catch {
      /* best-effort */
    }
  }
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err);
  process.exit(1);
});
