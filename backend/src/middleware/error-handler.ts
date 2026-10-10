import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "../lib/errors";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      details: err.details ?? undefined,
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Validasi gagal",
      details: err.flatten(),
    });
  }

  // Body JSON tak valid (express.json SyntaxError) — 400 jelas, bukan 500 generik.
  if (err instanceof SyntaxError && (err as { status?: number }).status === 400 && "body" in err) {
    return res.status(400).json({ error: "Body JSON tidak valid" });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({
        error: "Data duplikat (unique constraint)",
        details: err.meta,
      });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Data tidak ditemukan" });
    }
    return res.status(400).json({ error: "Kesalahan database", details: err.meta });
  }

  console.error("Unhandled error:", err);
  return res.status(500).json({ error: "Terjadi kesalahan pada server" });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} tidak ditemukan` });
}

// Membungkus async route handler supaya error otomatis diteruskan ke errorHandler
// tanpa perlu try/catch berulang di setiap controller.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
