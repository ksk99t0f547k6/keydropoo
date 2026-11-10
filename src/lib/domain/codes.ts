import { z } from "zod";

export const generationSchema = z.object({
  prefix: z.string().regex(/^[A-Za-z0-9_-]*$/).max(32).default(""),
  length: z.number().int().min(12).max(64).default(20),
  alphabet: z.string().min(2).max(64).regex(/^[A-Za-z0-9]+$/).refine((s) => new Set(s).size === s.length).default("ABCDEFGHJKLMNPQRSTUVWXYZ23456789"),
  groupSize: z.number().int().min(0).max(16).default(5),
  count: z.number().int().min(1).max(1000).default(1),
}).refine((r) => r.length * Math.log2(r.alphabet.length) >= 60, { message: "Code space must provide at least 60 bits of entropy" });

export function generateCodes(input: z.input<typeof generationSchema>): string[] {
  const rules = generationSchema.parse(input);
  const result = new Set<string>();
  // 拒絕抽樣避免取餘數造成字元機率偏差。
  const ceiling = Math.floor(256 / rules.alphabet.length) * rules.alphabet.length;
  while (result.size < rules.count) {
    let value = "";
    while (value.length < rules.length) {
      const bytes = crypto.getRandomValues(new Uint8Array(128));
      for (const byte of bytes) {
        if (byte >= ceiling) continue;
        value += rules.alphabet[byte % rules.alphabet.length];
        if (value.length === rules.length) break;
      }
    }
    if (rules.groupSize) value = value.match(new RegExp(`.{1,${rules.groupSize}}`, "g"))!.join("-");
    result.add(rules.prefix + value);
  }
  return [...result];
}

const encoder = new TextEncoder();
const bytesToHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, "0")).join("");
function fromHex(value: string) {
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2) throw new Error("INVALID_CIPHERTEXT");
  return Uint8Array.from(value.match(/../g)!, (s) => parseInt(s, 16));
}
export function encryptionKey(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("CODE_ENCRYPTION_KEY must be a 32-byte hexadecimal key");
  return crypto.subtle.importKey("raw", fromHex(value), "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function fingerprint(code: string) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(code)));
}
export async function sealCode(code: string, key: CryptoKey, context: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: encoder.encode(context) }, key, encoder.encode(code));
  return `v1:${bytesToHex(nonce.buffer)}:${bytesToHex(encrypted)}`;
}
export async function openCode(value: string, key: CryptoKey, context: string) {
  const parts = value.split(":");
  if (parts.length !== 3 || parts[0] !== "v1" || parts[1].length !== 24) throw new Error("INVALID_CIPHERTEXT");
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromHex(parts[1]), additionalData: encoder.encode(context) }, key, fromHex(parts[2]));
  return new TextDecoder().decode(raw);
}
