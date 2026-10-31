import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

import { AppError } from "../src/lib/errors";
import { closeControlDb, controlDb } from "../src/lib/tenancy/control-db";
import { generateMasterKey } from "../src/lib/tenancy/vault";
import { rotateVaultSecrets } from "../src/modules/platform/rotation";
import {
  createPlatformUser,
  resetPlatformUserTwoFactor,
  unlockPlatformUser,
} from "../src/modules/platform/service";

/**
 * Operaciones de la plataforma que se hacen desde el servidor, no desde el panel (el panel no existe todavía la primera
 * vez, y un administrador sin teléfono no puede entrar para pedir que le restablezcan el 2FA).
 *
 *   pnpm platform:create-admin            Crea un superadministrador (pide los datos; sin eco para la contraseña).
 *   pnpm platform:reset-2fa <usuario>     Quita su aplicación de autenticación: configurará una nueva al entrar.
 *   pnpm platform:unlock <usuario>        Levanta el bloqueo por intentos fallidos.
 *   pnpm platform:gen-key                 Imprime una llave maestra nueva para PLATFORM_MASTER_KEY.
 *   pnpm platform:rotate-key              Re-cifra los secretos con la llave maestra actual.
 *
 * Para automatizar `create-admin` se pueden pasar ADMIN_NAME, ADMIN_USERNAME y ADMIN_PASSWORD como variables de entorno.
 * Todo queda en la auditoría de la plataforma como acción del sistema.
 */

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

async function askCreateAdmin(): Promise<{ name: string; username: string; password: string }> {
  const { stream, muted } = createMutableOutput();
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
    const name = await ask("Nombre completo: ");
    const username = await ask("Usuario (minúsculas, números, . _ -): ");
    const password = await ask("Contraseña temporal (mínimo 12 caracteres): ", true);
    const again = await ask("Repite la contraseña: ", true);
    if (password !== again) {
      throw new Error("Las dos contraseñas no coinciden");
    }
    return { name, username, password };
  } finally {
    rl.close();
  }
}

async function findUserId(username: string): Promise<string> {
  const user = await controlDb.platformUser.findUnique({
    where: { username: username.trim().toLowerCase() },
    select: { id: true },
  });
  if (!user) {
    throw new Error(`No existe el administrador "${username}".`);
  }
  return user.id;
}

async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2);
  switch (command) {
    case "create-admin": {
      const fromEnv = process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD;
      const input = fromEnv
        ? {
            name: process.env.ADMIN_NAME ?? process.env.ADMIN_USERNAME ?? "",
            username: process.env.ADMIN_USERNAME ?? "",
            password: process.env.ADMIN_PASSWORD ?? "",
          }
        : await askCreateAdmin();
      const user = await createPlatformUser(input, { actor: null });
      const host = process.env.PLATFORM_HOST;
      console.log(`Listo: "${user.username}" ya puede entrar al panel de la plataforma.`);
      console.log(
        host
          ? `Dirección: ${host}/login — en su primer acceso configurará su aplicación de autenticación.`
          : "En su primer acceso configurará su aplicación de autenticación.",
      );
      console.log(
        "Esa persona debe entrar de inmediato: quien conozca la contraseña temporal antes podría configurar la verificación.",
      );
      return;
    }
    case "reset-2fa":
    case "unlock": {
      if (!argument) {
        throw new Error(`Uso: pnpm platform:${command} <usuario>`);
      }
      const userId = await findUserId(argument);
      if (command === "reset-2fa") {
        await resetPlatformUserTwoFactor(userId, { actor: null });
        console.log(
          "Verificación en dos pasos restablecida: configurará una nueva en su próximo acceso.",
        );
      } else {
        await unlockPlatformUser(userId, { actor: null });
        console.log("Cuenta desbloqueada.");
      }
      return;
    }
    case "gen-key": {
      console.log(generateMasterKey());
      console.error(
        "Guárdala en PLATFORM_MASTER_KEY y respáldala FUERA del servidor: sin ella no se pueden recuperar los secretos.",
      );
      return;
    }
    case "rotate-key": {
      const result = await rotateVaultSecrets(null);
      console.log(
        `Listo: ${result.rotated} secretos re-cifrados con la llave versión ${result.toVersion} (${result.alreadyCurrent} ya estaban al día).`,
      );
      return;
    }
    default:
      throw new Error(
        "Uso: pnpm platform:create-admin | platform:reset-2fa <usuario> | platform:unlock <usuario> | platform:gen-key | platform:rotate-key",
      );
  }
}

main()
  .catch((error: unknown) => {
    if (error instanceof AppError && error.code === "USERNAME_TAKEN") {
      console.error("Ese usuario ya existe: elige otro nombre de usuario.");
    } else if (error instanceof AppError && error.code === "VALIDATION") {
      console.error(`Dato inválido: ${error.message}`);
    } else {
      console.error(error instanceof Error ? error.message : error);
    }
    process.exitCode = 1;
  })
  .finally(() => closeControlDb());
