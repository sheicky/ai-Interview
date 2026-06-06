/**
 * Real round-trip + isolation check against Pinecone. Run with:
 *   npm run check:isolation
 * Requires PINECONE_API_KEY and PINECONE_INDEX in the environment (.env).
 */
import { randomUUID } from "node:crypto";
import { strict as assert } from "node:assert";
import { chunk, addSessionDocs, retrieve, deleteSessionDocs } from "../lib/rag";

function ok(name: string) {
  console.log(`✓ ${name}`);
}

async function retryRetrieve(q: string, sid: string, tries = 12) {
  // Pinecone upserts are eventually consistent; poll until visible.
  for (let i = 0; i < tries; i++) {
    const hits = await retrieve(q, sid);
    if (hits.length > 0) return hits;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return [];
}

async function main() {
  // --- pure helpers ---
  assert.deepEqual(chunk(""), []);
  assert.equal(chunk("a".repeat(900)).length, 2);
  ok("chunk() splits at ~800 chars and ignores empty");

  const sidA = randomUUID();
  const sidB = randomUUID();
  try {
    await addSessionDocs(sidA, [
      { kind: "cv", text: "Jane Doe is a senior payments engineer who built Stripe integrations." },
      { kind: "jd", text: "We are hiring a backend engineer for our billing platform." },
    ]);
    await addSessionDocs(sidB, [
      { kind: "cv", text: "John Smith is a marine biologist studying coral reefs." },
    ]);

    // Adversarial: query session A with a prompt that pulls semantically toward
    // session B's content. Namespace isolation must still return only A's own
    // docs and never B's "coral" text.
    const adversarial = "coral reef marine biology research";
    const hitsA = await retryRetrieve(adversarial, sidA);
    assert.ok(hitsA.length > 0, "session A should return its own docs");
    assert.ok(
      hitsA.every((h) => !h.text.toLowerCase().includes("coral")),
      "session A must NOT see session B's docs",
    );
    ok("retrieve() returns own docs and is isolated from other namespaces");

    await deleteSessionDocs(sidA);
    // Deletion is also eventually consistent; poll until the namespace clears.
    let afterDelete = await retrieve(adversarial, sidA);
    for (let i = 0; i < 12 && afterDelete.length > 0; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      afterDelete = await retrieve(adversarial, sidA);
    }
    assert.equal(afterDelete.length, 0, "deleted session should return nothing");
    ok("deleteSessionDocs() clears the namespace");

    console.log("\nALL SMOKE CHECKS PASSED");
  } finally {
    await deleteSessionDocs(sidA).catch(() => {});
    await deleteSessionDocs(sidB).catch(() => {});
  }
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err);
  process.exit(1);
});
