import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { comparePassword, hashPassword, isStrongPassword } from "../lib/password";
import { signAuthToken, verifyAuthToken } from "../lib/jwt";
import { isMailConfigured, sendResetPasswordEmail } from "../lib/mailer";
import { AppError } from "../lib/errors";
import { asyncHandler } from "../middleware/error-handler";
import { requireAuth } from "../middleware/auth";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Terlalu banyak percobaan login, coba lagi nanti" },
  keyGenerator: (req) => `${ipKeyGenerator(req.ip as string)}-${String((req.body as { email?: string })?.email || "").toLowerCase()}`,
});

// POST /api/auth/login
// Sama seperti frontend: tidak ada dropdown role, role otomatis terdeteksi dari user.
authRouter.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) {
      throw AppError.unauthorized("Email atau password salah");
    }

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      throw AppError.unauthorized("Email atau password salah");
    }

    const token = signAuthToken({
      userId: user.id,
      businessId: user.businessId,
      role: user.role as "owner" | "kasir" | "barista",
    });

    // 7d agar tidak ganggu jam sibuk kasir (silent refresh perpanjang otomatis)
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    // Set httpOnly cookie (lebih tahan XSS daripada localStorage) + tetap return token untuk backward compat
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      // Deno Deploy & Vercel beda domain, jadi production butuh SameSite=None
      sameSite: process.env.NODE_ENV === "production" ? ("none" as const) : "strict",
      maxAge,
      path: "/",
    });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        businessId: user.businessId,
      },
    });
  })
);

// GET /api/auth/me
authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
    if (!user) throw AppError.notFound("User tidak ditemukan");

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
      businessId: user.businessId,
    });
  })
);

// POST /api/auth/refresh — silent refresh tanpa login ulang (selama cookie masih valid & akun active)
authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const header = req.headers.authorization;
    let token: string | undefined;
    if (header && header.startsWith("Bearer ")) token = header.slice("Bearer ".length).trim();
    else if ((req as unknown as { cookies?: Record<string, string> }).cookies?.token) token = (req as unknown as { cookies: Record<string, string> }).cookies.token;
    if (!token) throw AppError.unauthorized("Tidak ada sesi untuk refresh");
    let payload: { userId: number; businessId: number; role: string };
    try {
      payload = verifyAuthToken(token);
    } catch {
      throw AppError.unauthorized("Sesi habis, silakan login ulang");
    }
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.active) throw AppError.unauthorized("Akun tidak aktif");
    if (user.role !== payload.role || user.businessId !== payload.businessId) throw AppError.unauthorized("Role/business berubah, silakan login ulang");
    const newToken = signAuthToken({ userId: user.id, businessId: user.businessId, role: user.role as "owner" | "kasir" | "barista" });
    res.cookie("token", newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      // Sama seperti login di atas: cross-site cookie untuk production
      sameSite: process.env.NODE_ENV === "production" ? ("none" as const) : "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });
    res.json({ token: newToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, businessId: user.businessId } });
  })
);

// POST /api/auth/logout — hapus httpOnly cookie
authRouter.post(
  "/logout",
  asyncHandler(async (_req, res) => {
    res.clearCookie("token", { path: "/" });
    res.json({ status: "ok" });
  })
);

// PATCH /api/auth/password — ganti password sendiri (semua role).
// Dipakai halaman Profile (owner) & Akun Frontoffice agar tidak lewat endpoint owner-only.
authRouter.patch(
  "/password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = z
      .object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) })
      .parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
    if (!user || !user.active) throw AppError.unauthorized("Akun tidak aktif");

    const valid = await comparePassword(currentPassword, user.passwordHash);
    if (!valid) throw AppError.badRequest("Password saat ini salah");
    if (!isStrongPassword(newPassword)) {
      throw AppError.badRequest("Password minimal 8 karakter, mengandung huruf, angka, dan simbol");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    res.json({ status: "ok" });
  })
);

const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Terlalu banyak permintaan reset, coba lagi nanti" },
  keyGenerator: (req) => `${ipKeyGenerator(req.ip as string)}-${String((req.body as { email?: string })?.email || "").toLowerCase()}`,
});

function webAppBaseUrl(): string {
  return (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
}

// POST /api/auth/forgot-password — minta link reset (khusus OWNER).
// Selalu 200 agar tidak bisa dipakai enumerasi email. Token acak disimpan
// sebagai hash, berlaku 1 jam, sekali pakai.
authRouter.post(
  "/forgot-password",
  forgotLimiter,
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.active && user.role === "owner") {
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      });
      const resetUrl = `${webAppBaseUrl()}/reset-password?token=${token}`;
      try {
        await sendResetPasswordEmail(user.email, resetUrl);
      } catch (e) {
        console.error("[forgot-password] gagal kirim email:", e);
      }
      // Dev tanpa SMTP: kembalikan link agar alur bisa diuji. Production: tidak pernah.
      if (!isMailConfigured() && process.env.NODE_ENV !== "production") {
        return res.json({ status: "ok", resetUrl });
      }
    }
    res.json({ status: "ok" });
  })
);

// POST /api/auth/reset-password — tukar token menjadi password baru.
authRouter.post(
  "/reset-password",
  forgotLimiter,
  asyncHandler(async (req, res) => {
    const { token, newPassword } = z
      .object({ token: z.string().min(1), newPassword: z.string().min(1) })
      .parse(req.body);
    if (!isStrongPassword(newPassword)) {
      throw AppError.badRequest("Password minimal 8 karakter, mengandung huruf, angka, dan simbol");
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw AppError.badRequest("Link reset tidak valid atau sudah kedaluwarsa");
    }
    const user = await prisma.user.findUnique({ where: { id: record.userId } });
    if (!user || !user.active || user.role !== "owner") {
      throw AppError.badRequest("Link reset tidak valid atau sudah kedaluwarsa");
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
    res.json({ status: "ok" });
  })
);
