type Environment = Record<string, string | undefined>;

export function validateRuntimeConfig(env: Environment): void {
  if (env.NODE_ENV !== "production") return;

  const required = [
    "DATABASE_URL", "JWT_SECRET", "CORS_ORIGIN", "PUBLIC_BASE_URL", "DOKU_NOTIFICATION_URL",
    "DOKU_CLIENT_ID", "DOKU_SECRET_KEY", "DOKU_PRIVATE_KEY", "DOKU_MERCHANT_ID", "DOKU_TERMINAL_ID",
  ];
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error(`Konfigurasi produksi wajib diisi: ${missing.join(", ")}`);
  if ((env.JWT_SECRET?.length ?? 0) < 32) throw new Error("JWT_SECRET produksi minimal 32 karakter acak");
  if (env.DOKU_IS_PRODUCTION !== "true") throw new Error("DOKU_IS_PRODUCTION wajib true di produksi");
  for (const value of [env.PUBLIC_BASE_URL!, env.DOKU_NOTIFICATION_URL!, ...env.CORS_ORIGIN!.split(",")]) {
    let url: URL;
    try { url = new URL(value.trim()); } catch { throw new Error("Origin dan callback produksi wajib URL HTTPS valid"); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      throw new Error("Origin dan callback produksi wajib HTTPS tanpa kredensial atau fragment");
    }
  }
  if (new URL(env.DOKU_NOTIFICATION_URL!).pathname !== "/api/public/doku/notification") {
    throw new Error("DOKU_NOTIFICATION_URL wajib memakai path /api/public/doku/notification");
  }
}
