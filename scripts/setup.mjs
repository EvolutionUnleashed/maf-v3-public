import process from "node:process";
import { config as loadEnv } from "dotenv";
import {
  assertSupportedNode,
  databaseFile,
  openLocalDatabase,
  verifyLocalDatabase,
} from "./setup-lib.mjs";

async function main() {
  assertSupportedNode();
  loadEnv({ path: ".env", quiet: true });

  console.log("Preparing private local workspace storage...");
  const client = openLocalDatabase();
  try {
    verifyLocalDatabase(client);
  } finally {
    client.close();
  }

  console.log(`[ok] SQLite database: ${databaseFile()}`);
  console.log("\nMAF V3 local storage is ready.");
  console.log("Start MAF V3, then add an Intelligence API key in Settings.");
}

main().catch(error => {
  console.error(`\nSetup stopped: ${error.message}`);
  console.error("Run `pnpm run doctor` after correcting the item above.");
  process.exitCode = 1;
});
