import app from "./app";
import { runMigrations } from "@workspace/db";

console.log("[STARTUP] API Server v2 - SSL fix + auto migration enabled");

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

runMigrations()
  .catch((err) => {
    console.error("Migration warning (non-fatal):", err?.message ?? err);
  })
  .finally(() => {
    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
  });
