import "dotenv/config";

import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";

import { seedBase } from "../prisma/seed/run-seed";
import { db } from "../src/lib/db";
import { AppError } from "../src/lib/errors";
import { createFirstOwner } from "../src/modules/users/bootstrap";

/**
 * Primer arranque de una instalación: deja la base lista (ubicación, caja, catálogos y ajustes iniciales, sin usuarios
 * de demostración) y crea al propietario. Se niega si ya hay uno activo.
 *
 * Pide los datos por teclado (la contraseña no se muestra). Para automatizarlo se pueden pasar OWNER_NAME,
 * OWNER_USERNAME, OWNER_PASSWORD y, opcional, OWNER_PIN como variables de entorno; en ese caso no se pregunta nada.
 */

/** Salida que se puede silenciar mientras se teclea la contraseña. */
function createMutableOutput(): { stream: Writable; muted: { value: boolean } } {
  const muted = { value: false };
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted.value) {
        process.stdout.write(chunk);
      }
      callback();
    },
  });
  return { stream, muted };
}

async function askAll(): Promise<{
  name: string;
  username: string;
  password: string;
  pin?: string;
}> {
  const { stream, muted } = createMutableOutput();
  // Sin terminal (p. ej. `docker compose exec -T`) no hay eco que ocultar y las líneas llegan todas juntas.
  const rl = createInterface({
    input: process.stdin,
    output: stream,
    terminal: Boolean(process.stdin.isTTY),
  });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (prompt: string, secret = false): Promise<string> => {
    process.stdout.write(prompt);
    muted.value = secret;
    const { value } = await lines.next();
    muted.value = false;
    if (secret) {
      process.stdout.write("\n");
    }
    return secret ? String(value ?? "") : String(value ?? "").trim();
  };
  try {
    const name = await ask("Nombre completo del propietario: ");
    const username = await ask("Usuario (letras minúsculas, números, . _ -): ");
    const password = await ask("Contraseña (mínimo 8 caracteres): ", true);
    const again = await ask("Repite la contraseña: ", true);
    if (password !== again) {
      throw new Error("Las dos contraseñas no coinciden");
    }
    const pin = await ask("PIN de 4 a 6 dígitos para autorizar (opcional, Enter para omitir): ");
    return { name, username, password, pin: pin || undefined };
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const fromEnv = process.env.OWNER_USERNAME && process.env.OWNER_PASSWORD;
  const input = fromEnv
    ? {
        name: process.env.OWNER_NAME ?? process.env.OWNER_USERNAME ?? "",
        username: process.env.OWNER_USERNAME ?? "",
        password: process.env.OWNER_PASSWORD ?? "",
        pin: process.env.OWNER_PIN || undefined,
      }
    : await askAll();

  await seedBase(db);
  await createFirstOwner(input, db);
  console.log(`Listo: el propietario "${input.username}" ya puede iniciar sesión.`);
  console.log("Entra al sistema y completa la bienvenida (datos del negocio, impuestos y cajas).");
}

main()
  .catch((error: unknown) => {
    if (error instanceof AppError && error.code === "CONFLICT") {
      console.error("Esta instalación ya tiene un propietario activo: no se crea otro.");
    } else if (error instanceof AppError && error.code === "USERNAME_TAKEN") {
      console.error("Ese usuario ya existe: elige otro nombre de usuario.");
    } else if (error instanceof AppError && error.code === "VALIDATION") {
      console.error(`Dato inválido: ${error.message}`);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
