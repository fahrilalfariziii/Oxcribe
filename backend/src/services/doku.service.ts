import crypto from "crypto";

// DOKU SNAP QRIS for central merchant collection.
export type DokuChargeResult = {
  /** ID unik versi kita (orderNumber + suffix base36). Dipakai sebagai
   *  partnerReferenceNo / trxId ke DOKU — untuk cek status & webhook. */
  partnerReferenceNo: string;
  /** Nomor struk internal (display kasir). */
  orderNumber: string;
  grossAmount: string;
  // QRIS
  qrContent?: string;
  referenceNo?: string;
  expiredDate?: string;
  raw: unknown;
};

export type DokuMethod = "qris";

/** Nomor invoice unik per charge: "<orderNumber>-<base36 timestamp>". */
export function makeDokuInvoiceId(orderNumber: string): string {
  const suffix = crypto.randomUUID().replace(/-/g, "");
  // DOKU partnerReferenceNo max 64 char
  return `${orderNumber.slice(0, 31)}-${suffix}`;
}

/** Ambil partnerReferenceNo charge terakhir dari payment tersimpan. */
export function dokuReferenceFromPayments(
  payments: Array<{ gatewayData?: unknown }> | undefined,
  fallbackOrderNumber: string
): string {
  const gd = payments?.[0]?.gatewayData as { partnerReferenceNo?: string } | undefined;
  return typeof gd?.partnerReferenceNo === "string" && gd.partnerReferenceNo.length > 0
    ? gd.partnerReferenceNo
    : fallbackOrderNumber;
}

function isProduction(): boolean {
  return (process.env.DOKU_IS_PRODUCTION || "false").toLowerCase() === "true";
}

export function dokuBaseUrl(): string {
  return isProduction() ? "https://api.doku.com" : "https://api-sandbox.doku.com";
}

function getDokuEnv(): {
  clientId: string;
  secretKey: string;
  privateKey: string;
  merchantId: string;
  terminalId: string;
  postalCode: string;
} | null {
  const clientId = process.env.DOKU_CLIENT_ID || "";
  const secretKey = process.env.DOKU_SECRET_KEY || "";
  const privateKeyRaw = process.env.DOKU_PRIVATE_KEY || "";
  const merchantId = process.env.DOKU_MERCHANT_ID || "";
  const terminalId = process.env.DOKU_TERMINAL_ID || "";
  const postalCode = process.env.DOKU_POSTAL_CODE || "10110";
  if (!clientId || !secretKey || !privateKeyRaw || !merchantId || !terminalId) return null;
  // .env menyimpan \n sebagai literal — kembalikan ke newline asli
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
  return { clientId, secretKey, privateKey, merchantId, terminalId, postalCode };
}

export function resolveDokuConfig() {
  const env = getDokuEnv();
  if (!env) return null;
  return { ...env, isProduction: isProduction(), baseUrl: dokuBaseUrl() };
}

/** Timestamp DOKU: YYYY-MM-DDTHH:mm:ss+07:00 (local Jakarta). */
export function dokuTimestamp(date = new Date()): string {
  const jakarta = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${jakarta.getUTCFullYear()}-${pad(jakarta.getUTCMonth() + 1)}-${pad(jakarta.getUTCDate())}` +
    `T${pad(jakarta.getUTCHours())}:${pad(jakarta.getUTCMinutes())}:${pad(jakarta.getUTCSeconds())}+07:00`
  );
}

/** X-EXTERNAL-ID: numeric string unik hari ini. */
export function dokuExternalId(): string {
  return `${Date.now()}${Math.floor(100000 + Math.random() * 899999)}`;
}

function minifyJson(body: unknown): string {
  return JSON.stringify(body);
}

function sha256HexLower(minified: string): string {
  return crypto.createHash("sha256").update(minified, "utf8").digest("hex").toLowerCase();
}

/** Symmetric signature: base64(HMAC_SHA512(secret, stringToSign)). */
export function buildSymmetricSignature(params: {
  secretKey: string;
  httpMethod: string;
  endpointUrl: string;
  accessToken: string;
  body: unknown;
  timestamp: string;
}): string {
  const digest = sha256HexLower(minifyJson(params.body));
  const stringToSign = `${params.httpMethod}:${params.endpointUrl}:${params.accessToken}:${digest}:${params.timestamp}`;
  return crypto.createHmac("sha512", params.secretKey).update(stringToSign, "utf8").digest("base64");
}

// ---- B2B Token (cache in-memory, expiry 900s) ----

let cachedToken: { token: string; expiresAt: number } | null = null;

function signB2BToken(clientId: string, privateKeyPem: string, timestamp: string): string {
  const stringToSign = `${clientId}|${timestamp}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(stringToSign, "utf8");
  sign.end();
  return sign.sign(privateKeyPem, "base64");
}

export async function getDokuB2BToken(): Promise<string | null> {
  const env = getDokuEnv();
  if (!env) return null;
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const timestamp = dokuTimestamp();
  let signature: string;
  try {
    signature = signB2BToken(env.clientId, env.privateKey, timestamp);
  } catch (e) {
    console.error("[DOKU token] gagal sign RSA:", (e as Error).message);
    return null;
  }

  const url = `${dokuBaseUrl()}/authorization/v1/access-token/b2b`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "Content-Type": "application/json",
        "X-CLIENT-KEY": env.clientId,
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
      },
      body: JSON.stringify({ grantType: "client_credentials" }),
    });
  } catch (e) {
    console.error("[DOKU token] network error:", (e as Error).message);
    return null;
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.accessToken !== "string") {
    console.error("[DOKU token] gagal:", res.status, JSON.stringify(data).slice(0, 500));
    return null;
  }
  const expiresIn = Number((data.expiresIn as string) || 900) || 900;
  cachedToken = { token: data.accessToken as string, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
  return cachedToken.token;
}

export function clearDokuTokenCache() {
  cachedToken = null;
}

function toAmountString(n: number): string {
  return `${Math.round(n)}.00`;
}

// ---- QRIS ----

const QR_GENERATE_PATH = "/snap-adapter/b2b/v1.0/qr/qr-mpm-generate";
const QR_QUERY_PATH = "/snap-adapter/b2b/v1.0/qr/qr-mpm-query";
const QR_EXPIRE_PATH = "/snap-adapter/b2b/v1.0/qr/qr-expire";

async function createDokuQris(params: {
  orderNumber: string;
  grossAmount: number;
  invoiceId?: string;
}): Promise<DokuChargeResult | null> {
  const env = getDokuEnv();
  if (!env) {
    console.warn("[DOKU charge] kredensial belum dikonfigurasi — order tanpa QR");
    return null;
  }
  const token = await getDokuB2BToken();
  if (!token) return null;

  const partnerReferenceNo = (params.invoiceId ?? makeDokuInvoiceId(params.orderNumber)).slice(0, 64);
  const expiry = new Date(Date.now() + 15 * 60 * 1000);
  const body = {
    partnerReferenceNo,
    amount: { value: toAmountString(params.grossAmount), currency: "IDR" },
    merchantId: env.merchantId,
    terminalId: env.terminalId,
    validityPeriod: dokuTimestamp(expiry),
    additionalInfo: { postalCode: env.postalCode, feeType: 1 },
  };
  const timestamp = dokuTimestamp();
  const signature = buildSymmetricSignature({
    secretKey: env.secretKey,
    httpMethod: "POST",
    endpointUrl: QR_GENERATE_PATH,
    accessToken: token,
    body,
    timestamp,
  });

  let res: Response;
  try {
    res = await fetch(`${dokuBaseUrl()}${QR_GENERATE_PATH}`, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "Content-Type": "application/json",
        "X-PARTNER-ID": env.clientId,
        "X-EXTERNAL-ID": dokuExternalId(),
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
        Authorization: `Bearer ${token}`,
        "CHANNEL-ID": "H2H",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`DOKU network error: ${(e as Error).message}`);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`DOKU QRIS gagal ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  const code = String(data.responseCode || "");
  if (!code.startsWith("200")) throw new Error(`DOKU QRIS ditolak ${code}: ${data.responseMessage || "unknown"}`);

  const qrContent = data.qrContent as string | undefined;
  if (!qrContent) throw new Error("DOKU QRIS tanpa qrContent");
  console.log(`[DOKU charge] QRIS ok invoice=${partnerReferenceNo} gross=${params.grossAmount}`);
  return {
    partnerReferenceNo,
    orderNumber: params.orderNumber,
    grossAmount: String(params.grossAmount),
    qrContent,
    referenceNo: (data.referenceNo as string) || undefined,
    expiredDate: (data.additionalInfo as { validityPeriod?: string } | undefined)?.validityPeriod ?? expiry.toISOString(),
    raw: data,
  };
}

/** Batalkan QRIS di DOKU (qr-expire) agar tak bisa dibayar setelah order dibatalkan lokal.
// Referensi: developers.doku.com Direct API SNAP "Cancel QRIS" — sukses = responseCode 2007700.
// Best-effort: return false (jangan lempar) agar kegagalan DOKU tak menggagalkan batal lokal. */
export async function expireDokuQris(params: {
  partnerReferenceNo: string;
  referenceNo?: string;
  reason?: string;
}): Promise<boolean> {
  const env = getDokuEnv();
  if (!env) {
    console.warn("[DOKU expire] kredensial belum dikonfigurasi — lewati expire");
    return false;
  }
  const token = await getDokuB2BToken();
  if (!token) return false;
  const body = {
    partnerReferenceNo: params.partnerReferenceNo,
    ...(params.referenceNo ? { referenceNo: params.referenceNo } : {}),
    merchantId: env.merchantId,
    ...(params.reason ? { reason: params.reason.slice(0, 128) } : {}),
  };
  const timestamp = dokuTimestamp();
  const signature = buildSymmetricSignature({
    secretKey: env.secretKey,
    httpMethod: "POST",
    endpointUrl: QR_EXPIRE_PATH,
    accessToken: token,
    body,
    timestamp,
  });
  let res: Response;
  try {
    res = await fetch(`${dokuBaseUrl()}${QR_EXPIRE_PATH}`, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "Content-Type": "application/json",
        "X-PARTNER-ID": env.clientId,
        "X-EXTERNAL-ID": dokuExternalId(),
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
        Authorization: `Bearer ${token}`,
        "CHANNEL-ID": "H2H",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.warn(`[DOKU expire] network error: ${(e as Error).message}`);
    return false;
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const code = String(data.responseCode || "");
  if (res.ok && code.startsWith("200")) {
    console.log(`[DOKU expire] QR expired invoice=${params.partnerReferenceNo} code=${code}`);
    return true;
  }
  console.warn(`[DOKU expire] gagal ${res.status} code=${code}: ${JSON.stringify(data).slice(0, 200)}`);
  return false;
}

export async function createDokuChargeForMethod(params: {
  method: DokuMethod;
  orderNumber: string;
  grossAmount: number;
  invoiceId: string;
}): Promise<DokuChargeResult | null> {
  if (params.method !== "qris") throw new Error("DOKU hanya mendukung QRIS");
  return createDokuQris(params);
}

// ---- Cek status ----

export async function getDokuQrisStatus(params: {
  partnerReferenceNo: string;
  referenceNo?: string;
}): Promise<Record<string, unknown> | null> {
  const env = getDokuEnv();
  if (!env) return null;
  const token = await getDokuB2BToken();
  if (!token) return null;
  const body = {
    originalReferenceNo: params.referenceNo ?? "",
    originalPartnerReferenceNo: params.partnerReferenceNo,
    serviceCode: "47",
    merchantId: env.merchantId,
  };
  const timestamp = dokuTimestamp();
  const signature = buildSymmetricSignature({
    secretKey: env.secretKey, httpMethod: "POST", endpointUrl: QR_QUERY_PATH,
    accessToken: token, body, timestamp,
  });
  try {
    const res = await fetch(`${dokuBaseUrl()}${QR_QUERY_PATH}`, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "Content-Type": "application/json",
        "X-PARTNER-ID": env.clientId,
        "X-EXTERNAL-ID": dokuExternalId(),
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
        Authorization: `Bearer ${token}`,
        "CHANNEL-ID": "H2H",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    console.warn(`[DOKU status] QRIS error:`, (e as Error).message);
    return null;
  }
}

/** Normalisasi status DOKU → paid/pending/failed/null. */
export function normalizeDokuStatus(raw: Record<string, unknown> | null): "paid" | "pending" | "failed" | "review" | null {
  if (!raw) return null;
  // QRIS query
  const latest = String(
    (raw.latestTransactionStatus as string) ?? (raw.transactionStatus as string) ?? ""
  ).toUpperCase();
  if (latest === "00" || latest === "SUCCESS" || latest === "SETTLEMENT" || latest === "PAID") return "paid";
  if (latest === "03" || latest === "PENDING") return "pending";
  if (["04", "REFUNDED"].includes(latest)) return "review";
  if (["05", "06", "FAILED", "EXPIRED", "CANCELLED"].includes(latest)) return "failed";
  return null;
}

// ---- Verifikasi notifikasi SNAP ----

export function verifyDokuNotification(params: {
  httpMethod: string;
  endpointPath: string;
  accessToken: string;
  body: unknown;
  timestamp: string;
  signature: string;
}): boolean {
  const env = getDokuEnv();
  if (!env) return false;
  const expected = buildSymmetricSignature({
    secretKey: env.secretKey,
    httpMethod: params.httpMethod,
    endpointUrl: params.endpointPath,
    accessToken: params.accessToken,
    body: params.body,
    timestamp: params.timestamp,
  });
  const a = Buffer.from(expected);
  const b = Buffer.from(params.signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
