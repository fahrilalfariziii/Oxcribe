import {
  buildSymmetricSignature,
  dokuBaseUrl,
  dokuExternalId,
  dokuTimestamp,
  getDokuB2BToken,
  resolveDokuConfig,
} from "./doku.service";
import type { DokuSubAccountRoute } from "./doku.service";
import { prisma } from "../lib/prisma";

// DOKU Sub-Account V2 (wallet-as-a-service) untuk model agregator SaaS.
// Satu sub-account per tenant (business): register -> profileId -> routing charge,
// split rule fee (opsional), balance monitoring, transfer (pencairan) ke bank owner.
// Auth sama seperti SNAP: B2B token + symmetric signature HMAC_SHA512.

export type DokuSubAccount = {
  profileId: string;
  parentProfileId?: string;
  accounts: unknown[];
  raw: unknown;
};

async function dokuSubPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const cfg = resolveDokuConfig();
  if (!cfg) throw new Error("Kredensial DOKU belum dikonfigurasi (.env)");
  const token = await getDokuB2BToken();
  if (!token) throw new Error("Gagal mendapatkan B2B token DOKU (cek private key / public key terdaftar)");
  const timestamp = dokuTimestamp();
  const signature = buildSymmetricSignature({
    secretKey: cfg.secretKey,
    httpMethod: "POST",
    endpointUrl: path,
    accessToken: token,
    body,
    timestamp,
  });
  let res: Response;
  try {
    res = await fetch(`${dokuBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PARTNER-ID": cfg.clientId,
        "X-EXTERNAL-ID": dokuExternalId(),
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`DOKU network error: ${(e as Error).message}`);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    responseCode?: string;
    responseMessage?: string;
  };
  if (!res.ok) {
    throw new Error(`DOKU ${path} gagal ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  const code = String(data.responseCode || "");
  if (!/^200/.test(code) && !/^0000/.test(code)) {
    throw new Error(`DOKU ${path} ditolak ${code}: ${data.responseMessage || "unknown"}`);
  }
  return data as T;
}

/** Sanitasi nama pemegang akun ke format DOKU (huruf/angka/spasi/.'-, maks 100).
 *  Karakter lain (mis. &) membuat DOKU menjawab 4000601 "Invalid Field Format name". */
export function sanitizeDokuAccountName(name: string, fallback: string): string {
  const clean = name
    .replace(/[^A-Za-z0-9 .'\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return clean || fallback;
}

/** Daftarkan sub-account untuk satu tenant. Balikan wajib disimpan (profileId + accounts). */
export async function registerDokuSubAccount(params: {
  referenceNo: string;
  name: string;
  email: string;
  phoneNo?: string;
}): Promise<DokuSubAccount> {
  // Batas DOKU: email maks 25 char — gagalkan cepat dengan pesan jelas (bukan 400 mentah).
  if (params.email.length > 25) {
    throw new Error(`Email "${params.email}" melebihi 25 karakter (batas DOKU register) — pakai email owner yang lebih pendek via override`);
  }
  let data: { profileId?: string; parentProfileId?: string; accounts?: unknown[] };
  try {
    data = await dokuSubPost<{
      profileId?: string;
      parentProfileId?: string;
      accounts?: unknown[];
    }>("/sub-account/v2.0/register", {
      partnerReferenceNo: params.referenceNo,
      type: "DEFAULT",
      name: sanitizeDokuAccountName(params.name, `Tenant ${params.referenceNo}`.slice(0, 100)),
      email: params.email,
      ...(params.phoneNo ? { phoneNo: params.phoneNo.slice(0, 15) } : {}),
      countryCode: "ID",
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("4000601")) {
      throw new Error(`${msg} (nama sub-account ditolak DOKU — pakai huruf/angka/spasi/.'- maks 100 karakter)`);
    }
    throw e;
  }
  if (!data.profileId) throw new Error("DOKU register tanpa profileId");
  console.log(`[DOKU sub-account] registered profile=${data.profileId} ref=${params.referenceNo}`);
  return {
    profileId: data.profileId,
    parentProfileId: data.parentProfileId,
    accounts: Array.isArray(data.accounts) ? data.accounts : [],
    raw: data,
  };
}

/** Saldo sub-account (available + reserved per tipe akun). */
export async function getDokuSubBalance(profileId: string): Promise<Record<string, unknown>> {
  return dokuSubPost("/sub-account/v2.0/balance-inquiries", { profileId });
}

// ---- Routing charge tervalidasi (anti silent-failure DOKU) ----

// DOKU TIDAK error saat profileId/split_rule_id invalid (dana mendarat tanpa split
// dan harus diurus manual). Karena itu routing charge wajib membuktikan profileId
// hidup via balance-inquiry, bukan sekadar percaya kolom DB. Hasil di-cache 1 jam
// agar checkout tak terbebani inquiry tiap transaksi.
const routeCache = new Map<number, { at: number; route: DokuSubAccountRoute | undefined }>();
const ROUTE_CACHE_TTL_MS = 60 * 60 * 1000;

/** Hapus cache routing tenant (dipanggil tiap register/split-rule/onboarding berubah). */
export function invalidateTenantSubAccountRoute(businessId: number): void {
  routeCache.delete(businessId);
}

/** Routing charge tervalidasi untuk satu tenant; undefined = fallback merchant utama. */
export async function resolveValidatedTenantRoute(businessId: number): Promise<DokuSubAccountRoute | undefined> {
  const cached = routeCache.get(businessId);
  if (cached && Date.now() - cached.at < ROUTE_CACHE_TTL_MS) return cached.route;
  let route: DokuSubAccountRoute | undefined;
  try {
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (business?.dokuSubAccountStatus === "active" && business.dokuProfileId) {
      const profileId: string = business.dokuProfileId;
      const candidate: DokuSubAccountRoute = {
        profileId,
        ...(business.dokuSplitRuleId ? { splitRuleId: business.dokuSplitRuleId } : {}),
      };
      await getDokuSubBalance(profileId); // bukti profileId hidup di DOKU
      route = candidate;
    }
  } catch (e) {
    console.warn(`[DOKU sub-account] routing tenant ${businessId} tak tervalidasi, fallback merchant utama:`, (e as Error).message);
    route = undefined;
  }
  routeCache.set(businessId, { at: Date.now(), route });
  return route;
}

export type DokuSubAccountEntry = {
  type?: string;
  accountNumber?: string;
  accountNo?: string | number;
};

/** Pilih nomor akun IDR (DOKU_MERCHANT_IDR) sebagai sumber pencairan.
 *  Jangan pakai accounts[0] mentah — urutan DOKU menaruh POINT paling
 *  depan dan transfer dari POINT selalu 403 insufficient balance. */
export function pickIdrAccountNumber(accounts: DokuSubAccountEntry[] | null | undefined): string | undefined {
  const list = Array.isArray(accounts) ? accounts : [];
  const idr = list.find((a) => a?.type === "DOKU_MERCHANT_IDR");
  const num = idr?.accountNumber ?? (idr?.accountNo !== undefined ? String(idr.accountNo) : undefined);
  if (num) return num;
  const first = list[0];
  return first?.accountNumber ?? (first?.accountNo !== undefined ? String(first.accountNo) : undefined);
}

/** Hasil transfer-inquiry DOKU (subset yang dipakai backend). */
export type DokuTransferInquiry = {
  referenceNo?: string;
  beneficiaryAccountName?: string;
  beneficiaryAccountNumber?: string;
  beneficiaryBankCode?: string;
};

export type DokuSplitRuleItem = {
  type: "PERCENTAGE" | "FLAT";
  value: number;
  currency?: string;
  accountNumber: string | number;
};

/** Buat split rule otomatis (mis. fee platform % ke sub-akun Oxcribe). */
export async function createDokuSplitRule(rules: DokuSplitRuleItem[]): Promise<string> {
  const data = await dokuSubPost<{ splitRuleId?: string }>("/sub-account/v2.0/split-rules", {
    transactionType: "PAYMENT",
    rules: rules.map((r) => ({
      type: r.type,
      value: r.value,
      ...(r.type === "FLAT" ? { currency: r.currency ?? "IDR" } : {}),
      accountNumber: r.accountNumber,
    })),
  });
  if (!data.splitRuleId) throw new Error("DOKU split-rules tanpa splitRuleId");
  return data.splitRuleId;
}

/** Inquiry transfer (pencairan) — validasi tujuan, hasilkan referenceNo. */
export async function inquiryDokuTransfer(params: {
  referenceNo: string;
  fromAccount: string;
  type: "BANK_ACCOUNT" | "DOKU_SUB_ACCOUNT" | "DOKU_WALLET";
  amount: number;
  beneficiaryBankCode?: string;
  beneficiaryAccountNumber: string;
  remark?: string;
}): Promise<Record<string, unknown>> {
  return dokuSubPost("/sub-account/v2.0/transfer-inquiry", {
    partnerReferenceNo: params.referenceNo,
    type: params.type,
    amount: { value: `${Math.round(params.amount)}.00`, currency: "IDR" },
    channel: "BI_FAST",
    fromAccount: params.fromAccount,
    ...(params.beneficiaryBankCode ? { beneficiaryBankCode: params.beneficiaryBankCode } : {}),
    beneficiaryAccountNumber: params.beneficiaryAccountNumber,
    ...(params.remark ? { remark: params.remark } : {}),
  });
}

/** Eksekusi transfer memakai referenceNo dari inquiry.
 *  DOKU mewajibkan detail transfer di-echo kembali (partnerReferenceNo,
 *  fromAccount, beneficiary*, amount) — referenceNo saja DITOLAK
 *  (4004302 Invalid Mandatory Field). Nama penerima pakai yang
 *  dikembalikan inquiry (jangan karang sendiri agar tak MISMATCH). */
export async function payDokuTransfer(params: {
  partnerReferenceNo: string;
  referenceNo: string;
  type: "BANK_ACCOUNT" | "DOKU_SUB_ACCOUNT" | "DOKU_WALLET";
  channel?: string;
  fromAccount: string;
  beneficiaryBankCode: string;
  beneficiaryAccountNumber: string;
  beneficiaryAccountName: string;
  amount: number;
}): Promise<Record<string, unknown>> {
  return dokuSubPost("/sub-account/v2.0/transfer-payment", {
    partnerReferenceNo: params.partnerReferenceNo,
    referenceNo: params.referenceNo,
    type: params.type,
    channel: params.channel ?? "BI_FAST",
    fromAccount: params.fromAccount,
    beneficiaryBankCode: params.beneficiaryBankCode,
    beneficiaryAccountNumber: params.beneficiaryAccountNumber,
    beneficiaryAccountName: params.beneficiaryAccountName,
    amount: { value: `${Math.round(params.amount)}.00`, currency: "IDR" },
  });
}
