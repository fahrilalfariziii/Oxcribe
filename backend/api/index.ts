import { createApp } from "../src/app";
import { initRealtime } from "../src/lib/realtime";

// Entry Vercel Function (@vercel/node): ekspor request handler Express.
// Env var disuntik Vercel (DATABASE_URL, REDIS_URL, dll), jadi tidak pakai dotenv.
const app = createApp();

// Bus realtime (Redis pub/sub) disiapkan saat instance dibangunkan.
// Tanpa REDIS_URL -> mode in-process (cukup untuk dev lokal / instance tunggal).
initRealtime().catch((e) => console.error("[realtime] init gagal:", e));

export default app;
