import process from "node:process";
import { config as loadEnv } from "dotenv";
import {
  assertSupportedNode,
  databaseFile,
  openExistingDatabase,
  verifyLocalDatabase,
} from "./setup-lib.mjs";

async function main() {
  console.log(`Node.js ${process.versions.node}`);
  assertSupportedNode();
  console.log("[ok] Supported Node.js version");
  loadEnv({ path: ".env", quiet: true });

  const client = openExistingDatabase();
  try {
    verifyLocalDatabase(client);
    console.log(`[ok] SQLite integrity and schema: ${databaseFile()}`);
  } finally {
    client.close();
  }

  console.log("\nDoctor found no local-storage problems.");
}

main().catch(error => {
  console.error(`\n[needs attention] ${error.message}`);
  process.exitCode = 1;
});
