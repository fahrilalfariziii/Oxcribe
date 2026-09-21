import crypto from "crypto";

const ALG = "aes-256-gcm";
const IV_LEN = 12;

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET || process.env.DOKU_KEY_ENCRYPTION_SECRET;
  if (!secret) throw new Error("ENCRYPTION_SECRET belum di-set di environment (.env)");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, getKey(), iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Invalid encrypted payload");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const enc = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv(ALG, getKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

export function isEncrypted(value: string): boolean {
  return value.split(":").length === 3 && /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(value);
}
