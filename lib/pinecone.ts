/**
 * Pinecone client + namespace-scoped index handle.
 *
 * One integrated index (server-side embeddings, model multilingual-e5-large)
 * named by PINECONE_INDEX. Each interview session uses its own namespace, so a
 * query in one session physically cannot read another's docs.
 */
import { Pinecone, type Index } from "@pinecone-database/pinecone";

const INDEX_NAME = process.env.PINECONE_INDEX ?? "interview-docs";

let client: Pinecone | null = null;

function getClient(): Pinecone {
  // The constructor reads PINECONE_API_KEY from env. Fail loud if it's missing,
  // rather than letting an unauthenticated request 401 deep in a handler.
  if (!process.env.PINECONE_API_KEY) {
    throw new Error("PINECONE_API_KEY is not set");
  }
  if (!client) client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  return client;
}

/** A handle to the index scoped to one session's namespace. */
export function sessionIndex(namespace: string): Index {
  return getClient().index({ name: INDEX_NAME }).namespace(namespace);
}
