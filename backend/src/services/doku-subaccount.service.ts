import {
  buildSymmetricSignature,
  dokuBaseUrl,
  dokuExternalId,
  dokuTimestamp,
  getDokuB2BToken,
  resolveDokuConfig,
} from "./doku.service";

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

/** Daftarkan sub-account untuk satu tenant. Balikan wajib disimpan (profileId + accounts). */
export async function registerDokuSubAccount(params: {
  referenceNo: string;
  name: string;
  email: string;
  phoneNo?: string;
}): Promise<DokuSubAccount> {
  const data = await dokuSubPost<{
    profileId?: string;
    parentProfileId?: string;
    accounts?: unknown[];
  }>("/sub-account/v2.0/register", {
    partnerReferenceNo: params.referenceNo,
    type: "DEFAULT",
    name: params.name.slice(0, 100),
    email: params.email,
    ...(params.phoneNo ? { phoneNo: params.phoneNo } : {}),
    countryCode: "ID",
  });
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

export type DokuSplitRuleItem = {
  type: "PERCENTAGE" | "FLAT";
  value: number;
  currency?: string;
  accountNumber: string | number;
};

/** Buat split rule otomatis (mis. fee platform % ke sub-akun Ordria). */
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
    fromAccount: params.fromAccount,
    ...(params.beneficiaryBankCode ? { beneficiaryBankCode: params.beneficiaryBankCode } : {}),
    beneficiaryAccountNumber: params.beneficiaryAccountNumber,
    ...(params.remark ? { remark: params.remark } : {}),
  });
}

/** Eksekusi transfer memakai referenceNo dari inquiry. */
export async function payDokuTransfer(params: {
  referenceNo: string;
  type: "BANK_ACCOUNT" | "DOKU_SUB_ACCOUNT" | "DOKU_WALLET";
}): Promise<Record<string, unknown>> {
  return dokuSubPost("/sub-account/v2.0/transfer-payment", {
    referenceNo: params.referenceNo,
    type: params.type,
  });
}
