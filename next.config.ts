import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / heavy server-only packages must not be bundled by the compiler.
  serverExternalPackages: [
    "better-sqlite3",
    "@lancedb/lancedb",
    "@xenova/transformers",
    "unpdf",
  ],
};

export default nextConfig;
