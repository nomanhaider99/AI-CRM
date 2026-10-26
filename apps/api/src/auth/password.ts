import { hash, verify } from "@node-rs/argon2";

// @node-rs/argon2 defaults: argon2id, m=19456 KiB, t=2, p=1 (OWASP minimum recommendation).
export const hashPassword = (password: string) => hash(password);

let dummyHash: Promise<string> | undefined;

/**
 * Verifies a password. With no stored hash (unknown email) it still runs a full verify against a
 * dummy hash, so response time does not reveal whether the account exists.
 */
export async function verifyPassword(storedHash: string | undefined, password: string): Promise<boolean> {
  if (!storedHash) {
    dummyHash ??= hash("dummy-password-for-constant-time");
    await verify(await dummyHash, password);
    return false;
  }
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}
