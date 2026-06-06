/**
 * Local sentence embeddings via transformers.js (all-MiniLM-L6-v2, 384-dim).
 * The model downloads once on first use and is cached on disk. Off the network
 * thereafter — this is the "local embedding model" the latency budget wanted.
 */
import { pipeline } from "@xenova/transformers";

const MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBED_DIM = 384;

// Minimal callable shape so we don't depend on transformers' exported types.
type Extractor = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

let extractorPromise: Promise<Extractor> | null = null;

function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL) as unknown as Promise<Extractor>;
  }
  return extractorPromise;
}

/** Embed a batch of texts into normalized 384-dim vectors. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist();
}
