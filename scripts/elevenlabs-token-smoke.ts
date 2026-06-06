/**
 * Unit checks for the ElevenLabs token route — mocked fetch, no network, no keys.
 *   npm run check:token
 */
import { strict as assert } from "node:assert";
import { NextRequest } from "next/server";
import { GET } from "../app/api/elevenlabs/token/route";

function ok(name: string) {
  console.log(`✓ ${name}`);
}
const req = () => new NextRequest("http://localhost/api/elevenlabs/token");

async function main() {
  const savedKey = process.env.ELEVENLABS_API_KEY;
  const savedAgent = process.env.ELEVENLABS_AGENT_ID;
  const origFetch = globalThis.fetch;
  try {
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_AGENT_ID;
    assert.equal((await GET(req())).status, 500);
    ok("missing env → 500");

    process.env.ELEVENLABS_API_KEY = "test-key";
    process.env.ELEVENLABS_AGENT_ID = "agent_x";
    let calledUrl = "";
    let calledKey = "";
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calledUrl = String(url);
      calledKey = String((init?.headers as Record<string, string>)?.["xi-api-key"] ?? "");
      return new Response(JSON.stringify({ token: "tok_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const res = await GET(req());
    assert.equal(res.status, 200);
    assert.equal((await res.json()).token, "tok_123");
    assert.ok(calledUrl.includes("/v1/convai/conversation/token"), "calls token endpoint");
    assert.ok(calledUrl.includes("agent_id=agent_x"), "passes agent_id");
    assert.equal(calledKey, "test-key", "sends xi-api-key");
    ok("mints token with xi-api-key + agent_id");

    globalThis.fetch = (async () => new Response("nope", { status: 401 })) as typeof fetch;
    assert.equal((await GET(req())).status, 502);
    ok("upstream error → 502");

    console.log("\nALL TOKEN SMOKE CHECKS PASSED");
  } finally {
    globalThis.fetch = origFetch;
    if (savedKey) process.env.ELEVENLABS_API_KEY = savedKey;
    else delete process.env.ELEVENLABS_API_KEY;
    if (savedAgent) process.env.ELEVENLABS_AGENT_ID = savedAgent;
    else delete process.env.ELEVENLABS_AGENT_ID;
  }
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err);
  process.exit(1);
});
