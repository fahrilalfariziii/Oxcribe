import { EventEmitter } from "events";
import type { Request, Response } from "express";
import { createClient, type RedisClientType } from "redis";
import { verifyAuthToken } from "./jwt";
import { prisma } from "./prisma";
import { AppError } from "./errors";

// ---- Tipe event realtime (nama dipertahankan dari era Socket.io agar
// frontend tinggal ganti transport tanpa ubah logika handler) ----
export const REALTIME_EVENTS = [
  "order:new",
  "order:status_updated",
  "order:payment_updated",
  "product:availability_updated",
  "ingredient:stock_updated",
  "business:cash_updated",
  "business:updated",
] as const;

export type RealtimeEventType = (typeof REALTIME_EVENTS)[number];

type BufferedEntry = { id: number; type: RealtimeEventType; data: unknown };
type Subscriber = { res: Response; businessId: number; lastSentId: number; heartbeat: NodeJS.Timeout };

const CHANNEL = "oxcribe:realtime";
const BUFFER_PER_BUSINESS = 50;
const HEARTBEAT_MS = 25000;

const subscribers = new Set<Subscriber>();
const buffers = new Map<number, BufferedEntry[]>();
let seq = 0;

const bus = new EventEmitter();
bus.setMaxListeners(0);

let redisPub: RedisClientType | null = null;
let redisInitStarted = false;

/**
 * Dipanggil sekali dari index.ts (menggantikan initSocket).
 * Tanpa REDIS_URL -> mode in-process (single instance, perilaku lama).
 * Dengan REDIS_URL (mis. Upstash) -> publish/subscribe lintas instance.
 */
export async function initRealtime(): Promise<void> {
  if (redisInitStarted) return;
  redisInitStarted = true;
  const url = (process.env.REDIS_URL || "").trim();
  if (!url) {
    console.log("[realtime] mode in-process (tanpa REDIS_URL)");
    return;
  }
  try {
    const sub = createClient({ url });
    sub.on("error", (e) => console.error("[realtime:redis] subscriber error:", e));
    await sub.connect();
    await sub.subscribe(CHANNEL, (raw) => {
      try {
        const msg = JSON.parse(raw) as { businessId: number; type: RealtimeEventType; data: unknown; id: number };
        if (typeof msg.businessId !== "number" || typeof msg.type !== "string") return;
        deliverLocal(msg.businessId, msg.type, msg.data, msg.id);
      } catch (e) {
        console.error("[realtime:redis] pesan tak valid:", e);
      }
    });
    redisPub = createClient({ url });
    redisPub.on("error", (e) => console.error("[realtime:redis] publisher error:", e));
    await redisPub.connect();
    console.log("[realtime] mode redis (lintas instance aktif)");
  } catch (e) {
    console.error("[realtime:redis] gagal konek, fallback in-process:", e);
    redisPub = null;
  }
}

function pushBuffer(businessId: number, entry: BufferedEntry) {
  const list = buffers.get(businessId) ?? [];
  list.push(entry);
  while (list.length > BUFFER_PER_BUSINESS) list.shift();
  buffers.set(businessId, list);
}

function deliverLocal(businessId: number, type: RealtimeEventType, data: unknown, id?: number) {
  const entry: BufferedEntry = { id: id ?? ++seq, type, data };
  if (id !== undefined && id > seq) seq = id;
  pushBuffer(businessId, entry);
  const line = `id: ${entry.id}\nevent: ${entry.type}\ndata: ${JSON.stringify(entry.data ?? null)}\n\n`;
  for (const sub of subscribers) {
    if (sub.businessId !== businessId || entry.id <= sub.lastSentId) continue;
    try {
      sub.res.write(line);
      sub.lastSentId = entry.id;
    } catch {
      // tulis gagal -> koneksi mati, biarkan handler 'close' membersihkan
    }
  }
  bus.emit(`business:${businessId}`, entry);
}

function publish(businessId: number, type: RealtimeEventType, data: unknown) {
  if (redisPub) {
    // Echo Redis kembali ke instance ini juga, jadi JANGAN deliverLocal langsung (anti dobel).
    const id = ++seq;
    redisPub.publish(CHANNEL, JSON.stringify({ businessId, type, data, id })).catch((e) => {
      console.error("[realtime:redis] publish gagal, fallback lokal:", e);
      deliverLocal(businessId, type, data);
    });
    return;
  }
  deliverLocal(businessId, type, data);
}

async function resolveBusinessId(query: Record<string, unknown>): Promise<number> {
  const token = typeof query.token === "string" ? query.token : undefined;
  // Staff: pakai businessId dari JWT, jangan percaya kiriman client.
  // Samakan dengan requireAuth: tolak token platform + cek DB agar staff yang
  // dinonaktifkan/diubah role/bisnisnya langsung kehilangan akses SSE.
  if (token) {
    let decoded: { userId: number; businessId: number; role: string; scope?: string };
    try {
      decoded = verifyAuthToken(token);
    } catch {
      throw AppError.unauthorized("Token tidak valid");
    }
    if (decoded.scope === "platform") {
      throw AppError.unauthorized("Sesi platform admin tidak berlaku di sini");
    }
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || !user.active) throw AppError.unauthorized("Akun tidak aktif");
    if (user.role !== decoded.role) throw AppError.unauthorized("Role tidak lagi valid, silakan login ulang");
    if (user.businessId !== decoded.businessId) throw AppError.unauthorized("Akses bisnis tidak valid");
    return decoded.businessId;
  }
  // Pelanggan self-order: wajib kirim qrToken meja, resolve businessId via DB
  const qrToken =
    typeof query.qrToken === "string" ? query.qrToken
    : typeof query.tableToken === "string" ? query.tableToken
    : undefined;
  if (!qrToken) throw AppError.badRequest("qrToken wajib diisi untuk pelanggan");
  const table = await prisma.cafeTable.findUnique({ where: { qrToken } });
  if (!table || !table.isActive) throw AppError.notFound("QR meja tidak valid atau tidak aktif");
  return table.businessId;
}

/**
 * GET /api/stream — ganti 'join' Socket.io.
 * Contoh staff:  /api/stream?token=JWT
 * Contoh tamu:   /api/stream?qrToken=table-01
 * Resume: kirim header Last-Event-ID, server replay buffer yang terlewat.
 */
export async function handleStream(req: Request, res: Response): Promise<void> {
  let businessId: number;
  try {
    businessId = await resolveBusinessId(req.query as Record<string, unknown>);
  } catch (e) {
    const status = (e as unknown as { statusCode?: number }).statusCode ?? 401;
    const message = e instanceof Error ? e.message : "Unauthorized";
    res.status(status).json({ error: message });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  // Saran interval reconnect client (EventSource patuh otomatis)
  res.write("retry: 5000\n\n");

  const lastIdHeader = req.headers["last-event-id"];
  const lastId = typeof lastIdHeader === "string" ? Number(lastIdHeader) : NaN;
  const sub: Subscriber = {
    res,
    businessId,
    lastSentId: Number.isFinite(lastId) ? (lastId as number) : 0,
    heartbeat: setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch {
        // abaikan, 'close' yang membersihkan
      }
    }, HEARTBEAT_MS),
  };
  // Batasi umur koneksi agar token basi dinilai ulang saat reconnect
  // (EventSource menyambung ulang otomatis dan mengulang resolveBusinessId).
  const MAX_STREAM_MS = 6 * 60 * 60 * 1000;
  const lifetime = setTimeout(() => {
    try {
      res.end();
    } catch {
      // abaikan, 'close' yang membersihkan
    }
  }, MAX_STREAM_MS);
  // Hindari timeout proxy yang menutup koneksi idle terlalu cepat
  (req.socket as unknown as { setTimeout?: (ms: number) => void }).setTimeout?.(0);
  subscribers.add(sub);

  // Replay event yang terlewat saat reconnect
  for (const entry of buffers.get(businessId) ?? []) {
    if (entry.id <= sub.lastSentId) continue;
    try {
      res.write(`id: ${entry.id}\nevent: ${entry.type}\ndata: ${JSON.stringify(entry.data ?? null)}\n\n`);
      sub.lastSentId = entry.id;
    } catch {
      break;
    }
  }

  req.on("close", () => {
    clearInterval(sub.heartbeat);
    clearTimeout(lifetime);
    subscribers.delete(sub);
  });
}

// ---- Event emitter helpers (nama & signature dipertahankan dari era Socket.io,
// jadi services/controllers TIDAK perlu diubah selain path import) ----

export function emitNewOrder(businessId: number, order: unknown) {
  publish(businessId, "order:new", order);
}

export function emitOrderStatusUpdate(businessId: number, order: unknown) {
  publish(businessId, "order:status_updated", order);
}

export function emitOrderPaymentUpdate(businessId: number, order: unknown) {
  publish(businessId, "order:payment_updated", order);
}

export function emitProductAvailabilityUpdate(businessId: number, product: unknown) {
  publish(businessId, "product:availability_updated", product);
}

export function emitStockUpdate(businessId: number, ingredient: unknown) {
  publish(businessId, "ingredient:stock_updated", ingredient);
}

export function emitBusinessCashUpdate(businessId: number, cash: unknown) {
  publish(businessId, "business:cash_updated", cash);
}

export function emitBusinessUpdated(businessId: number, business: unknown) {
  publish(businessId, "business:updated", business);
}
