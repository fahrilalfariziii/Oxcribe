import {
  buildSymmetricSignature,
  dokuBaseUrl,
  dokuExternalId,
  dokuTimestamp,
  getDokuB2BToken,
  resolveDokuConfig,
} from "./doku.service";
import { AppError } from "../lib/errors";

export interface BankInquiryResult {
  bankCode: string;
  bankAccount: string;
  accountName: string;
  raw?: unknown;
}

/**
 * Validasi Rekening Bank Tujuan via DOKU SNAP Bank Account Inquiry API.
 * Endpoint: /snap/v1.1/emoney/bank-account-inquiry
 */
export async function inquiryBankAccount(params: {
  bankCode: string;
  bankAccount: string;
}): Promise<BankInquiryResult> {
  const { bankCode, bankAccount } = params;
  if (!bankCode || !bankAccount) {
    throw AppError.badRequest("Kode bank dan nomor rekening wajib diisi");
  }

  const cleanAccount = bankAccount.trim().replace(/[^0-9]/g, "");
  if (!cleanAccount) {
    throw AppError.badRequest("Nomor rekening hanya boleh berisi angka");
  }

  const cfg = resolveDokuConfig();

  // Jika kredensial belum ada (development sandbox / mockup fallback)
  if (!cfg) {
    console.warn("[doku-inquiry] DOKU belum dikonfigurasi, menggunakan mock inquiry untuk development");
    return {
      bankCode,
      bankAccount: cleanAccount,
      accountName: "MERCHANT TEST DEV (SIMULASI)",
    };
  }

  const token = await getDokuB2BToken();
  if (!token) {
    throw new AppError("Gagal mengotentikasi B2B Token ke DOKU", 500);
  }

  const path = "/snap/v1.1/emoney/bank-account-inquiry";
  const timestamp = dokuTimestamp();
  const body = {
    beneficiaryBankCode: bankCode,
    beneficiaryAccountNumber: cleanAccount,
    channelCode: "11", // BI-FAST
  };

  const signature = buildSymmetricSignature({
    secretKey: cfg.secretKey,
    httpMethod: "POST",
    endpointUrl: path,
    accessToken: token,
    body,
    timestamp,
  });

  try {
    const res = await fetch(`${dokuBaseUrl()}${path}`, {
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

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      console.warn(`[doku-inquiry] Gagal HTTP ${res.status}:`, data);
      const errMsg = (data.responseMessage as string) || (data.message as string) || "Rekening tidak ditemukan atau bank tidak merespon";
      throw AppError.badRequest(`Gagal validasi rekening DOKU: ${errMsg}`);
    }

    const accountName =
      (data.beneficiaryAccountName as string) ||
      (data.accountName as string) ||
      (data.beneficiaryName as string) ||
      "";

    if (!accountName) {
      throw AppError.badRequest("Nama pemilik rekening tidak ditemukan dari respon bank");
    }

    return {
      bankCode,
      bankAccount: cleanAccount,
      accountName: accountName.toUpperCase().trim(),
      raw: data,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("[doku-inquiry] Network error:", error);
    throw AppError.badRequest(`Koneksi ke verifikasi rekening DOKU gagal: ${(error as Error).message}`);
  }
}
