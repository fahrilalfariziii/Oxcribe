import "dotenv/config";
import http from "http";
import { createApp } from "./app";
import { initRealtime } from "./lib/realtime";

const PORT = Number(process.env.PORT) || 4000;

const app = createApp();
const server = http.createServer(app);

// Realtime SSE tidak butuh attach ke server HTTP (murni request/response),
// tapi initRealtime menyiapkan bus Redis bila REDIS_URL di-set.
initRealtime().catch((e) => console.error("[realtime] init gagal:", e));

server.listen(PORT, () => {
  console.log(`Oxcribe backend jalan di http://localhost:${PORT}`);
  console.log(`Health check:      http://localhost:${PORT}/health`);
  console.log(`API base:          http://localhost:${PORT}/api`);
});
