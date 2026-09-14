import crypto from "crypto";
import { decrypt } from "../lib/encryption";

export type MidtransChargeResult = {
  transactionId: string;
  /** ID unik yang dikirim ke Midtrans (orderNumber + suffix). Inilah yang dipakai
   *  untuk cek status & webhook — BUKAN orderNumber struk yang boleh berulang. */
  orderId: string;
  /** Nomor struk internal (untuk display/kasir). */
  orderNumber: string;
  grossAmount: string;
  qrUrl?: string;
  qrString?: string;
  vaNumber?: string;
  vaBank?: string;
  /** Mandiri e-channel: kode perusahaan (sama utk semua transaksi) + bill key (unik). */
  billerCode?: string;
  redirectUrl?: string;
  raw: unknown;
};

/**
 * Nomor struk (BE-9028) boleh berulang antar seed/attempt, tapi Midtrans menolak
 * order_id duplikat (QRIS) — walau VA mentoleransinya. Maka setiap charge memakai
 * ID unik: "<orderNumber>-<base36 timestamp>".
 */
export function makeMidtransOrderId(orderNumber: string): string {
  const suffix = Date.now().toString(36);
  return `${orderNumber}-${suffix}`;
}

/** Ambil ID Midtrans yang dipakai saat charge dari payment tersimpan. */
export function midtransOrderIdFromPayments(
  payments: Array<{ gatewayData?: unknown }> | undefined,
  fallbackOrderNumber: string
): string {
  const gd = payments?.[0]?.gatewayData as { orderId?: string } | undefined;
  return typeof gd?.orderId === "string" && gd.orderId.length > 0 ? gd.orderId : fallbackOrderNumber;
}

function getMidtransConfigForBusiness(business: {
  midtransMode?: string | null;
  midtransServerKeyEnc?: string | null;
  midtransClientKey?: string | null;
  midtransQrisAcquirer?: string | null;
  paymentSettings?: unknown;
}): { serverKey: string; clientKey: string; isProduction: boolean; qrisAcquirer: string } | null {
  const isProduction = (process.env.MIDTRANS_IS_PRODUCTION || "false").toLowerCase() === "true";
  const globalServerKey = process.env.MIDTRANS_SERVER_KEY || "";
  const globalClientKey = process.env.MIDTRANS_CLIENT_KEY || "";
  const globalAcquirer = process.env.MIDTRANS_QRIS_ACQUIRER || "gopay";

  const mode = (business.midtransMode as string) || "global";
  if (mode === "custom" && business.midtransServerKeyEnc) {
    try {
      const serverKey = decrypt(business.midtransServerKeyEnc);
      const clientKey = (business.midtransClientKey as string) || globalClientKey;
      const acquirer = (business.midtransQrisAcquirer as string) || globalAcquirer;
      if (!serverKey) return null;
      return { serverKey, clientKey, isProduction, qrisAcquirer: acquirer };
    } catch {
      return null;
    }
  }
  if (!globalServerKey) return null;
  return { serverKey: globalServerKey, clientKey: globalClientKey, isProduction, qrisAcquirer: globalAcquirer };
}

function midtransBaseUrl(isProduction: boolean): string {
  return isProduction ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
}

function notificationUrl(): string | undefined {
  return process.env.MIDTRANS_NOTIFICATION_URL || undefined;
}

export function resolveMidtransConfig(business: Parameters<typeof getMidtransConfigForBusiness>[0]) {
  return getMidtransConfigForBusiness(business);
}

export async function createMidtransQrisCharge(params: {
  business: Parameters<typeof getMidtransConfigForBusiness>[0];
  orderNumber: string;
  grossAmount: number;
  customerName?: string | null;
  itemDetails?: { id: string; price: number; quantity: number; name: string }[];
}): Promise<MidtransChargeResult | null> {
  const cfg = getMidtransConfigForBusiness(params.business);
  if (!cfg) return null;
  return createQrisWithConfig(cfg, params.orderNumber, params.grossAmount, params.customerName, params.itemDetails);
}

export type MidtransItemDetail = { id: string; price: number; quantity: number; name: string };

// Bangun item_details Midtrans dari order Prisma.
// - id traceable ke productId (unik per baris: p<productId>[-n] untuk varian ganda).
// - name = productName (+optionsLabel) dipotong 50 char (limit Midtrans).
// - SERVICE, TAX & PLATFORM_FEE sebagai line item terpisah agar sum(price*qty) == gross_amount.
// - customer_details cukup first_name (sesuai konfirmasi).
export function buildMidtransItemDetails(order: {
  items: Array<{ productId: number; productName: string; price: unknown; quantity: number; optionsLabel?: string | null }>;
  serviceCharge: unknown;
  tax: unknown;
  taxLabel?: string | null;
  platformFee?: unknown;
}): MidtransItemDetail[] {
  const seen = new Map<number, number>();
  const items: MidtransItemDetail[] = (order.items || []).map((i) => {
    const count = (seen.get(i.productId) || 0) + 1;
    seen.set(i.productId, count);
    const baseName = String(i.productName || "Item");
    const variant = i.optionsLabel ? ` (${i.optionsLabel})` : "";
    return {
      id: count > 1 ? `p${i.productId}-${count}` : `p${i.productId}`,
      price: Math.round(Number(i.price) || 0),
      quantity: Math.max(1, Math.round(Number(i.quantity) || 1)),
      name: `${baseName}${variant}`.slice(0, 50),
    };
  });

  const service = Math.round(Number(order.serviceCharge) || 0);
  if (service > 0) {
    items.push({ id: "SERVICE", price: service, quantity: 1, name: "Service Charge" });
  }
  const tax = Math.round(Number(order.tax) || 0);
  if (tax > 0) {
    const label = String(order.taxLabel || "Pajak").slice(0, 50);
    items.push({ id: "TAX", price: tax, quantity: 1, name: label });
  }
  const platformFee = Math.round(Number(order.platformFee) || 0);
  if (platformFee > 0) {
    items.push({ id: "PLATFORM_FEE", price: platformFee, quantity: 1, name: "Biaya Layanan Aplikasi" });
  }
  return items.filter((i) => i.price >= 0 && i.quantity >= 1 && i.name.length > 0);
}

function sanitizedItemDetails(
  itemDetails: MidtransItemDetail[] | undefined,
  grossAmount: number
): MidtransItemDetail[] | undefined {
  if (!itemDetails || itemDetails.length === 0) return undefined;
  const sum = itemDetails.reduce((s, i) => s + i.price * i.quantity, 0);
  // Midtrans tolak jika sum != gross_amount → omit seluruhnya agar charge tetap sukses.
  if (sum !== Math.round(grossAmount)) return undefined;
  return itemDetails;
}

export async function createMidtransChargeForMethod(params: {
  business: Parameters<typeof getMidtransConfigForBusiness>[0];
  method: "qris" | "bank_transfer";
  orderNumber: string;
  grossAmount: number;
  customerName?: string | null;
  paymentSettings?: Record<string, { acquirer?: string; bank?: string; allowedBanks?: string[] }>;
  selectedBank?: string;
  itemDetails?: MidtransItemDetail[];
}): Promise<MidtransChargeResult | null> {
  const cfg = getMidtransConfigForBusiness(params.business);
  if (!cfg) return null;

  const ps = params.paymentSettings || {};
  const midtransOrderId = makeMidtransOrderId(params.orderNumber);
  const item_details = sanitizedItemDetails(params.itemDetails, params.grossAmount);
  if (params.method === "qris") {
    // Acquirer opsional — Midtrans default gopay. Jangan kirim field qris sama sekali
    // agar ikut default Midtrans (sesuai docs: qris object Optional).
    return chargeWithBody(cfg, {
      payment_type: "qris",
      transaction_details: { order_id: midtransOrderId, gross_amount: params.grossAmount },
      customer_details: { first_name: params.customerName || "Tamu" },
      ...(item_details ? { item_details } : {}),
    }, params.orderNumber);
  }
  if (params.method === "bank_transfer") {
    // Bank yang didukung Core API klasik — JANGAN tambah di luar ini (SeaBank hanya via BI-SNAP).
    // Nilai basi (permata/cimb/dll) dari pengaturan lama disaring, bukan dipakai.
    const SUPPORTED_BANKS = ["bca", "mandiri", "bni", "bri"] as const;
    const stored = (ps.bank_transfer as { allowedBanks?: string[]; bank?: string } | undefined);
    const allowed = ((stored?.allowedBanks ?? (stored?.bank ? [stored.bank] : undefined)) ?? [])
      .filter((b): b is (typeof SUPPORTED_BANKS)[number] => (SUPPORTED_BANKS as readonly string[]).includes(b));
    const requested = params.selectedBank || stored?.bank || "bca";
    if (!(SUPPORTED_BANKS as readonly string[]).includes(requested)) {
      throw new Error(`Bank "${requested}" tidak didukung. Pilih: BCA, Mandiri, BNI, BRI.`);
    }
    // Pilihan pelanggan adalah kebenaran — TIDAK boleh disubstitusi diam-diam ke bank lain.
    // Dulu: fallback allowed[0] menyebabkan charge Permata padahal pelanggan pilih Mandiri.
    if (allowed.length > 0 && !allowed.includes(requested as (typeof SUPPORTED_BANKS)[number])) {
      throw new Error(`Bank "${requested.toUpperCase()}" tidak aktif. Pilih bank lain yang tersedia.`);
    }
    const bank = requested;
    // MANDIRI = Bill Payment via jalur "echannel" (BUKAN bank_transfer) sesuai docs Midtrans:
    // payment_type "echannel" + objek echannel{bill_info1, bill_info2}.
    // Mengirim mandiri lewat bank_transfer menghasilkan perilaku tak terdefinisi
    // (Sandbox pernah membalas Permata) — jangan pernah lakukan itu lagi.
    if (bank === "mandiri") {
      return chargeWithBody(cfg, {
        payment_type: "echannel",
        transaction_details: { order_id: midtransOrderId, gross_amount: params.grossAmount },
        customer_details: { first_name: params.customerName || "Tamu" },
        echannel: {
          bill_info1: "PEMBAYARAN",
          bill_info2: midtransOrderId.slice(-30),
        },
        ...(item_details ? { item_details } : {}),
      }, params.orderNumber);
    }
    // BCA, BNI, BRI: Virtual Account klasik.
    return chargeWithBody(cfg, {
      payment_type: "bank_transfer",
      transaction_details: { order_id: midtransOrderId, gross_amount: params.grossAmount },
      customer_details: { first_name: params.customerName || "Tamu" },
      bank_transfer: { bank },
      ...(item_details ? { item_details } : {}),
    }, params.orderNumber);
  }
  return null;
}

async function createQrisWithConfig(
  cfg: { serverKey: string; isProduction: boolean; qrisAcquirer: string },
  orderNumber: string,
  grossAmount: number,
  customerName?: string | null,
  itemDetails?: { id: string; price: number; quantity: number; name: string }[]
): Promise<MidtransChargeResult> {
  // Jangan kirim qris.acquirer — ikut default Midtrans (gopay).
  return chargeWithBody(cfg, {
    payment_type: "qris",
    transaction_details: { order_id: makeMidtransOrderId(orderNumber), gross_amount: grossAmount },
    customer_details: { first_name: customerName || "Tamu" },
    ...(itemDetails ? { item_details: itemDetails } : {}),
  }, orderNumber);
}

async function chargeWithBody(
  cfg: { serverKey: string; isProduction: boolean },
  body: Record<string, unknown>,
  orderNumber: string
): Promise<MidtransChargeResult> {
  const url = `${midtransBaseUrl(cfg.isProduction)}/v2/charge`;
  const auth = Buffer.from(`${cfg.serverKey}:`).toString("base64");
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Basic ${auth}`,
  };
  const notif = notificationUrl();
  if (notif) headers["X-Override-Notification"] = notif;

  // Log operasional permanen (tanpa secret): pasangan minta-vs-balas adalah
  // satu-satunya vonis saat bank hasil beda dari bank yang diminta.
  const txDetails = body.transaction_details as { order_id?: string; gross_amount?: number } | undefined;
  const bankReq = (body.bank_transfer as { bank?: string } | undefined)?.bank
    ?? ((body.echannel as Record<string, unknown> | undefined) ? "mandiri(echannel)" : String(body.payment_type ?? "?"));
  console.log(`[Midtrans charge] req payment_type=${body.payment_type} bank=${bankReq} order_id=${txDetails?.order_id} gross=${txDetails?.gross_amount}`);

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (e) {
    throw new Error(`Midtrans network error: ${(e as Error).message}`);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  
  if (!res.ok) {
    const msg = (data.status_message as string) || `Midtrans charge failed ${res.status}`;
    // Ambil detail validation message kalo ada
    const validationMsgs = Array.isArray(data.validation_messages) 
      ? ` (${(data.validation_messages as string[]).join(", ")})` 
      : "";
    
    throw new Error(`${msg}${validationMsgs}`);
  }

  const transactionId = (data.transaction_id as string) || "";
  const orderId = (data.order_id as string) || (body.transaction_details as { order_id: string })?.order_id || "";
  const grossAmount = String(data.gross_amount ?? (body.transaction_details as { gross_amount: number })?.gross_amount ?? "");
  const actions = (data.actions as { name: string; url: string }[]) || [];
  const qrUrl = actions.find((a) => a.name === "generate-qr-code-v2")?.url || actions.find((a) => a.name === "generate-qr-code")?.url;
  const qrString = data.qr_string as string | undefined;
  const vaNumbers = data.va_numbers as { bank: string; va_number: string }[] | undefined;
  // Format nomor berbeda per bank — baca semuanya agar tidak ada yang hilang misterius:
  // BCA/BNI/BRI/CIMB -> va_numbers[0]; Permata -> permata_va_number top-level;
  // Mandiri bill -> bill_key (+biller_code bila ada).
  const permataVa = data.permata_va_number as string | undefined;
  const billKey = data.bill_key as string | undefined;
  const billerCode = data.biller_code as string | undefined;
  const vaNumber = vaNumbers?.[0]?.va_number ?? permataVa ?? billKey;
  const vaBank = vaNumbers?.[0]?.bank ?? (permataVa ? "permata" : billKey ? "mandiri" : undefined);
  const redirectUrl = (data.redirect_url as string) || (actions.find((a) => a.name === "deeplink-redirect")?.url);
  console.log(`[Midtrans charge] res order_id=${orderId} vaBank=${vaBank ?? "-"} va=${vaNumber ? "***" + String(vaNumber).slice(-4) : "-"} qr=${qrUrl ? "yes" : "no"}`);

  return { transactionId, orderId, orderNumber, grossAmount, qrUrl, qrString, vaNumber, vaBank, billerCode, redirectUrl, raw: data };
}

export function verifyMidtransSignature(payload: {
  order_id: string;
  status_code: string;
  gross_amount: string;
  signature_key: string;
  serverKey: string;
}): boolean {
  const expected = crypto
    .createHash("sha512")
    .update(`${payload.order_id}${payload.status_code}${payload.gross_amount}${payload.serverKey}`)
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
    b = Buffer.from(payload.signature_key, "hex");
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function getMidtransTransactionStatus(
  business: Parameters<typeof getMidtransConfigForBusiness>[0],
  orderId: string
): Promise<Record<string, unknown> | null> {
  const cfg = getMidtransConfigForBusiness(business);
  if (!cfg) return null;
  const url = `${midtransBaseUrl(cfg.isProduction)}/v2/${encodeURIComponent(orderId)}/status`;
  const auth = Buffer.from(`${cfg.serverKey}:`).toString("base64");
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", Authorization: `Basic ${auth}` } });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    console.warn(`[Midtrans status] network error for ${orderId}:`, (e as Error).message);
    return null;
  }
}
