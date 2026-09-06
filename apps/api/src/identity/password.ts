import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
const keyLength = 64;
const parameters = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

function scrypt(password: string, salt: Buffer, length: number, options: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => nodeScrypt(password, salt, length, options, (error, derived) => {
    if (error) reject(error); else resolve(derived);
  }));
}

export function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 1024) {
    throw new Error("Passwords must contain between 12 and 1024 characters");
  }
}

export async function createPasswordVerifier(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, keyLength, parameters);
  return `scrypt$${parameters.N}$${parameters.r}$${parameters.p}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, verifier: string): Promise<boolean> {
  const [algorithm, n, r, p, encodedSalt, encodedDerived] = verifier.split("$");
  if (algorithm !== "scrypt" || !n || !r || !p || !encodedSalt || !encodedDerived) return false;
  const expected = Buffer.from(encodedDerived, "base64url");
  try {
    const actual = await scrypt(password, Buffer.from(encodedSalt, "base64url"), expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
