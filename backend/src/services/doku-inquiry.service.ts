import { AppError } from "../lib/errors";
export interface BankInquiryResult {
  bankCode: string;
  bankAccount: string;
  accountName: string;
}
export async function inquiryBankAccount(_params: {
  bankCode: string;
  bankAccount: string;
}): Promise<BankInquiryResult> {
  throw AppError.badRequest("Verifikasi rekening dilakukan manual oleh superadmin dengan bukti kepemilikan rekening");
}
