import { hash, verify, type Algorithm } from "@node-rs/argon2";

/** `Algorithm.Argon2id` — the package ships a const enum, which isolatedModules can't import. */
const ARGON2ID = 2 as Algorithm;

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations, 1 lane).
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** A real hash used to spend the same time when the email does not exist (prevents user enumeration). */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("timing-equalizer-not-a-real-password");
  return dummyHash;
}
