/** Shared on-disk location for the SQLite DB. Single source of truth so db.ts
 *  uses one root. (Vector storage now lives in Pinecone, not on disk.) */
export const DATA_DIR = process.env.DATA_DIR ?? ".data";
