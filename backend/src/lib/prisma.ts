import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Singleton PrismaClient — mencegah membuat banyak koneksi saat hot-reload di development.
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Rust-free Prisma Client (queryCompiler) butuh driver adapter; ini juga jalur
// yang kompatibel dengan Deno Deploy. Pool pakai DATABASE_URL (Neon pooled).
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

export const prisma =
  global.__prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
