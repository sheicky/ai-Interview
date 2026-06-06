/**
 * GET /api/elevenlabs/token — mint a WebRTC conversation token for the browser
 * client, using the server-side ELEVENLABS_API_KEY so it never reaches the client.
 */
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!apiKey || !agentId) {
    return Response.json({ error: "ElevenLabs is not configured" }, { status: 500 });
  }
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { "xi-api-key": apiKey } },
    );
    if (!res.ok) {
      console.error("[elevenlabs/token] upstream error:", res.status);
      return Response.json({ error: "could not get conversation token" }, { status: 502 });
    }
    const data = (await res.json()) as { token?: string };
    if (!data.token) {
      return Response.json({ error: "no token in response" }, { status: 502 });
    }
    return Response.json({ token: data.token });
  } catch (err) {
    console.error("[elevenlabs/token] fetch failed:", err);
    return Response.json({ error: "could not get conversation token" }, { status: 502 });
  }
}
