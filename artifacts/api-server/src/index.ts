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
  .then(() => {
    console.log("[MIGRATION] 완료");
  })
  .catch((err) => {
    console.error("[MIGRATION] 실패:", err?.message ?? err);
    if (err?.cause) console.error("[MIGRATION] 원인:", err.cause);
  })
  .finally(() => {
    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
  });
