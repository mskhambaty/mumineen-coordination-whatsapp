import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const HASH_PREFIX = "scrypt";
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;

  return `${HASH_PREFIX}$${salt}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [prefix, salt, hash] = storedHash.split("$");
  if (prefix !== HASH_PREFIX || !salt || !hash) {
    return false;
  }

  const storedKey = Buffer.from(hash, "hex");
  const suppliedKey = (await scryptAsync(password, salt, storedKey.length)) as Buffer;

  return storedKey.length === suppliedKey.length && timingSafeEqual(storedKey, suppliedKey);
}

export function createPasswordResetToken() {
  const token = randomBytes(32).toString("base64url");

  return {
    token,
    tokenHash: hashPasswordResetToken(token),
  };
}

export function hashPasswordResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isValidNewPassword(password: string) {
  return password.length >= 8;
}
