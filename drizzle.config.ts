import { mkdirSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

const dataDir = path.resolve(
  process.env.MAF_DATA_DIR?.trim() || path.join(process.cwd(), "data"),
);
mkdirSync(dataDir, { recursive: true, mode: 0o700 });

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: path.join(dataDir, "maf-v3.sqlite"),
  },
});
