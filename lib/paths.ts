/** Shared on-disk locations for the SQLite DB and LanceDB. Single source of truth
 *  so db.ts and rag.ts can never drift onto different roots. */
import { join } from "node:path";

export const DATA_DIR = process.env.DATA_DIR ?? ".data";
export const LANCE_DIR = join(DATA_DIR, "lancedb");
