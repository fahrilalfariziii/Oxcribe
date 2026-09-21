import crypto from "crypto";

// DOKU SNAP Direct API (custom UI penuh — bukan Checkout hosted).
// Referensi: developers.doku.com Direct API SNAP (QRIS qr-mpm-generate/query,
// VA bi-snap-va create-va/status, B2B token, symmetric signature).
// Pola sama seperti Midtrans dulu: order dibuat dulu, lalu charge;
// gateway="doku", gatewayData menyimpan partnerReferenceNo unik per charge.

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
  // VA
  vaNumber?: string;
  vaBank?: string;
  partnerServiceId?: string;
  customerNo?: string;
  expiredDate?: string;
  howToPayPage?: string;
  raw: unknown;
};

export type DokuMethod = "qris" | "bank_transfer";

/** Nomor invoice unik per charge: "<orderNumber>-<base36 timestamp>". */
export function makeDokuInvoiceId(orderNumber: string): string {
  const suffix = Date.now().toString(36);
  // DOKU partnerReferenceNo max 64 char
  return `${orderNumber}-${suffix}`.slice(0, 64);
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

function dokuBaseUrl(): string {
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
function dokuExternalId(): string {
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

// ---- Virtual Account (DGPC) ----

const VA_CREATE_PATH = "/virtual-accounts/bi-snap-va/v1.1/transfer-va/create-va";
const VA_STATUS_PATH = "/orders/v1.0/transfer-va/status";

const VA_CHANNEL: Record<string, string> = {
  bca: "VIRTUAL_ACCOUNT_BCA",
  // Mandiri memakai _BANK_ (lihat spesimen resmi Mandiri VA DGPC) — tanpa ini 4002701 channel.
  mandiri: "VIRTUAL_ACCOUNT_BANK_MANDIRI",
  bni: "VIRTUAL_ACCOUNT_BNI",
  bri: "VIRTUAL_ACCOUNT_BRI",
};

const SUPPORTED_BANKS = ["bca", "mandiri", "bni", "bri"] as const;

function numericCustomerNo(invoiceId: string): string {
  const digits = invoiceId.replace(/\D/g, "").slice(-12) || String(Date.now()).slice(-12);
  const rand = String(Math.floor(100000 + Math.random() * 899999));
  return `${digits}${rand}`.slice(-20);
}

/** Partner Service ID (kode perusahaan/BIN DOKU, 8 digit left-padding spasi).
 *  Diterbitkan DOKU per merchant per bank — lihat .env. Return "" bila belum diisi. */
function getVAServiceId(bank: string): string {
  const perBank: Record<string, string | undefined> = {
    bca: process.env.DOKU_VA_BCA_SERVICE_ID,
    mandiri: process.env.DOKU_VA_MANDIRI_SERVICE_ID,
    bni: process.env.DOKU_VA_BNI_SERVICE_ID,
    bri: process.env.DOKU_VA_BRI_SERVICE_ID,
  };
  const raw = (perBank[bank] ?? process.env.DOKU_PARTNER_SERVICE_ID ?? "").trim();
  if (!raw) return "";
  return raw.padStart(8, " ").slice(-8);
}

async function createDokuVA(params: {
  orderNumber: string;
  grossAmount: number;
  customerName?: string | null;
  bank: string;
  invoiceId?: string;
}): Promise<DokuChargeResult | null> {
  const env = getDokuEnv();
  if (!env) {
    console.warn("[DOKU charge] kredensial belum dikonfigurasi — order tanpa VA");
    return null;
  }
  const bank = params.bank.toLowerCase();
  if (!(SUPPORTED_BANKS as readonly string[]).includes(bank)) {
    throw new Error(`Bank "${params.bank}" tidak didukung. Pilih: BCA, Mandiri, BNI, BRI.`);
  }
  const token = await getDokuB2BToken();
  if (!token) return null;

  const partnerReferenceNo = (params.invoiceId ?? makeDokuInvoiceId(params.orderNumber)).slice(0, 64);
  const partnerServiceId = getVAServiceId(bank);
  if (!partnerServiceId) {
    throw new Error(
      `Partner Service ID VA ${bank.toUpperCase()} belum dikonfigurasi (isi DOKU_VA_${bank.toUpperCase()}_SERVICE_ID atau DOKU_PARTNER_SERVICE_ID di .env)`
    );
  }
  // DGPC: customerNo merchant hanya PREFIX pendek per bank ("Prefix Sub BIN Merchant",
  // contoh resmi: "0"), lalu DOKU generate 20 digit penuh di respons.
  // Prefix tiap bank BISA BEDA (lihat tabel dashboard) — salah prefix = 4032715.
  const prefixPerBank: Record<string, string | undefined> = {
    bca: process.env.DOKU_VA_BCA_CUSTOMER_PREFIX,
    mandiri: process.env.DOKU_VA_MANDIRI_CUSTOMER_PREFIX,
    bni: process.env.DOKU_VA_BNI_CUSTOMER_PREFIX,
    bri: process.env.DOKU_VA_BRI_CUSTOMER_PREFIX,
  };
  const customerPrefix = (prefixPerBank[bank] ?? process.env.DOKU_VA_CUSTOMER_PREFIX ?? "0").trim() || "0";
  const customerNo = customerPrefix;
  const virtualAccountNo = `${partnerServiceId}${customerPrefix}`.slice(-28);
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const body = {
    partnerServiceId,
    customerNo,
    virtualAccountNo,
    virtualAccountName: (params.customerName || "Tamu").slice(0, 255),
    trxId: partnerReferenceNo,
    totalAmount: { value: toAmountString(params.grossAmount), currency: "IDR" },
    additionalInfo: { channel: VA_CHANNEL[bank] },
    virtualAccountTrxType: "C",
    expiredDate: dokuTimestamp(expiry),
  };
  const timestamp = dokuTimestamp();
  const signature = buildSymmetricSignature({
    secretKey: env.secretKey,
    httpMethod: "POST",
    endpointUrl: VA_CREATE_PATH,
    accessToken: token,
    body,
    timestamp,
  });

  let res: Response;
  try {
    res = await fetch(`${dokuBaseUrl()}${VA_CREATE_PATH}`, {
      method: "POST",
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
  if (!res.ok) throw new Error(`DOKU VA gagal ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  const code = String(data.responseCode || "");
  if (!code.startsWith("200")) throw new Error(`DOKU VA ditolak ${code}: ${data.responseMessage || "unknown"}`);

  const vaData = (data.virtualAccountData as Record<string, unknown> | undefined) ?? {};
  const vaNumber =
    (vaData.virtualAccountNo as string) || (vaData.virtualAccountNumber as string) || undefined;
  if (!vaNumber) throw new Error("DOKU VA tanpa virtualAccountNo");
  console.log(`[DOKU charge] VA ok bank=${bank} invoice=${partnerReferenceNo} va=***${vaNumber.slice(-4)}`);
  return {
    partnerReferenceNo,
    orderNumber: params.orderNumber,
    grossAmount: String(params.grossAmount),
    vaNumber,
    vaBank: bank,
    partnerServiceId: (vaData.partnerServiceId as string) || undefined,
    customerNo: (vaData.customerNo as string) || customerNo,
    expiredDate: (vaData.expiredDate as string) || expiry.toISOString(),
    howToPayPage: ((data.additionalInfo as Record<string, unknown> | undefined)?.howToPayPage as string) || undefined,
    raw: data,
  };
}

export async function createDokuChargeForMethod(params: {
  method: DokuMethod;
  orderNumber: string;
  grossAmount: number;
  customerName?: string | null;
  selectedBank?: string;
  invoiceId?: string;
}): Promise<DokuChargeResult | null> {
  if (params.method === "qris") {
    return createDokuQris({ orderNumber: params.orderNumber, grossAmount: params.grossAmount, invoiceId: params.invoiceId });
  }
  if (params.method === "bank_transfer") {
    return createDokuVA({
      orderNumber: params.orderNumber,
      grossAmount: params.grossAmount,
      customerName: params.customerName,
      bank: params.selectedBank || "bca",
      invoiceId: params.invoiceId,
    });
  }
  return null;
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

export async function getDokuVAStatus(params: {
  partnerServiceId?: string;
  customerNo?: string;
  virtualAccountNo?: string;
}): Promise<Record<string, unknown> | null> {
  const env = getDokuEnv();
  if (!env) return null;
  const token = await getDokuB2BToken();
  if (!token) return null;
  const body = {
    partnerServiceId: params.partnerServiceId ?? "",
    customerNo: params.customerNo ?? "",
    virtualAccountNo: params.virtualAccountNo ?? "",
    additionalInfo: {},
  };
  const timestamp = dokuTimestamp();
  const signature = buildSymmetricSignature({
    secretKey: env.secretKey, httpMethod: "POST", endpointUrl: VA_STATUS_PATH,
    accessToken: token, body, timestamp,
  });
  try {
    const res = await fetch(`${dokuBaseUrl()}${VA_STATUS_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PARTNER-ID": env.clientId,
        "X-EXTERNAL-ID": dokuExternalId(),
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    console.warn(`[DOKU status] VA error:`, (e as Error).message);
    return null;
  }
}

/** Normalisasi status DOKU → paid/pending/failed/null. */
export function normalizeDokuStatus(raw: Record<string, unknown> | null): "paid" | "pending" | "failed" | null {
  if (!raw) return null;
  // QRIS query
  const latest = String(
    (raw.latestTransactionStatus as string) ?? (raw.transactionStatus as string) ?? ""
  ).toUpperCase();
  if (latest === "00" || latest === "SUCCESS" || latest === "SETTLEMENT" || latest === "PAID") return "paid";
  if (latest === "03" || latest === "PENDING") return "pending";
  if (["04", "05", "06", "07", "FAILED", "EXPIRED", "CANCELLED", "REFUNDED"].includes(latest)) return "failed";
  // VA status: paidAmount + paymentRequestId menandakan lunas
  const vaData = raw.virtualAccountData as Record<string, unknown> | undefined;
  if (vaData) {
    if (vaData.paymentRequestId) return "paid";
    const reason = ((vaData.paymentFlagReason as Record<string, string> | undefined)?.english ?? "").toUpperCase();
    if (reason.includes("SUCCESS") || reason.includes("PAID")) return "paid";
    if (reason.includes("PENDING") || reason.includes("BELUM")) return "pending";
  }
  const code = String(raw.responseCode || "");
  if (code.startsWith("200") && raw.paidTime) return "paid";
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
