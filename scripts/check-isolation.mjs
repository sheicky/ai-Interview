// Adversarial session-isolation check (the R2 guarantee).
// Two sessions' docs live in one LanceDB table. We query as session A using a
// prompt semantically CLOSER to session B's content, and assert the session_id
// metadata filter still returns ONLY session A's docs. Run: npm run check:isolation
import * as lancedb from "@lancedb/lancedb";
import { pipeline } from "@xenova/transformers";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
const embed = async (texts) =>
  (await extractor(texts, { pooling: "mean", normalize: true })).tolist();

const dir = mkdtempSync(join(tmpdir(), "iso-"));
const db = await lancedb.connect(dir);

const docA = "Candidate A led distributed payment systems and ledger reconciliation at Acme.";
const docB = "Candidate B is a pastry chef who specializes in laminated croissant dough.";
const [va] = await embed([docA]);
const [vb] = await embed([docB]);
const table = await db.createTable("docs", [
  { vector: va, session_id: "A", text: docA },
  { vector: vb, session_id: "B", text: docB },
]);

// Query as session A, but ask about B's topic on purpose.
const [q] = await embed(["tell me about baking croissants and pastry technique"]);
const rows = await table.search(q).where("session_id = 'A'").limit(5).toArray();

console.log("returned:", rows.map((r) => ({ session: r.session_id, text: r.text.slice(0, 45) })));
const leaked = rows.some((r) => r.session_id !== "A");
if (rows.length === 0 || leaked) {
  console.error("FAIL: session isolation breached (or empty result).");
  process.exit(1);
}
console.log("PASS: session A returned only session A docs despite the query pulling toward B.");
