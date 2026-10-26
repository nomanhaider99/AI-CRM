import { createApp } from "./app";
import { sqlClient } from "./db/client";
import { env } from "./env";

const server = createApp().listen(env.API_PORT, () => {
  console.log(`API listening on http://localhost:${env.API_PORT}`);
});

const shutdown = () => {
  server.close(() => void sqlClient.end().then(() => process.exit(0)));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
