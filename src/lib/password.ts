import { hash, verify } from "@node-rs/argon2";

// algorithm 2 = Argon2id y version 1 = 0x13: valores numéricos porque `isolatedModules`
// no permite usar los `const enum` ambientales del paquete.
const HASH_OPTIONS = {
  algorithm: 2,
  version: 1,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashSecret(plain: string): Promise<string> {
  return hash(plain, HASH_OPTIONS);
}

export async function verifySecret(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
