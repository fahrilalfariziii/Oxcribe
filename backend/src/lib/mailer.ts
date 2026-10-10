import nodemailer from "nodemailer";

// Pengiriman email transaksional (link reset password owner).
// Tanpa SMTP_* di .env (dev) -> link hanya dicetak ke console, tidak dikirim.

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export function isMailConfigured(): boolean {
  return smtpConfigured();
}

export async function sendResetPasswordEmail(to: string, resetUrl: string): Promise<void> {
  if (!smtpConfigured()) {
    console.log(`[mailer:dev] SMTP belum dikonfigurasi — link reset untuk ${to}: ${resetUrl}`);
    return;
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: (process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: "Reset password akun Oxcribe Anda",
    text: [
      "Halo,",
      "",
      "Kami menerima permintaan reset password untuk akun Oxcribe Anda.",
      `Klik link berikut (berlaku 1 jam, sekali pakai): ${resetUrl}`,
      "",
      "Abaikan email ini bila Anda tidak memintanya.",
    ].join("\n"),
  });
}
