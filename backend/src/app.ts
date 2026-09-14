import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { apiRouter } from "./routes";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";

function getCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN;
  if (!raw) {
    if (process.env.NODE_ENV === "production") throw new Error("CORS_ORIGIN wajib di-set di production (.env)");
    return ["http://localhost:5173"];
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function createApp() {
  const app = express();
  // Trust proxy: development pakai 1 hop (ngrok), production pakai 1 hop yang aman & terbaik
  // Di prod, X-Forwarded-For hanya dipercaya dari 1 proxy terdekat (Nginx/Railway) — tidak semua hop.
  app.set('trust proxy', 1);

  // Security headers standar
  app.use(helmet());
  app.use(cookieParser());

  // Public endpoints (tanpa credentials, boleh longgar) — dipasang sebelum auth
  const publicOrigins = getCorsOrigins();
  app.use("/api/public", cors({ origin: publicOrigins, credentials: false }));
  
  // Auth & staff endpoints (butuh credentials, origin harus spesifik)
  const authOrigins = getCorsOrigins();
  app.use("/api/auth", cors({ origin: authOrigins, credentials: true }));
  app.use("/api/business", cors({ origin: authOrigins, credentials: true }));
  app.use("/api/staff", cors({ origin: authOrigins, credentials: true }));
  app.use("/api/tables", cors({ origin: authOrigins, credentials: true }));
  app.use("/api/categories", cors({ origin: authOrigins, credentials: true }));
  app.use("/api/products", cors({ origin: authOrigins, credentials: true }));
  app.use("/api/orders", cors({ origin: authOrigins, credentials: true }));
  app.use("/api/ingredients", cors({ origin: authOrigins, credentials: true }));
  app.use("/api/analytics", cors({ origin: authOrigins, credentials: true }));
  app.use("/api/platform", cors({ origin: authOrigins, credentials: true }));

  // Limit 5mb: logo/foto dikirim sebagai dataURL base64 (file 2MB -> ~2.8MB).
  // Default Express 100kb menolaknya dengan PayloadTooLargeError.
  app.use(express.json({ limit: "5mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "ordria-backend",
      time: new Date().toISOString(),
      build: "2026-09-12-no-vercel",
    });
  });

  app.use("/api", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}