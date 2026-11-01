import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

import { AppError } from "../src/lib/errors";
import { closeControlDb, controlDb } from "../src/lib/tenancy/control-db";
import { generateMasterKey } from "../src/lib/tenancy/vault";
import { listTenants } from "../src/modules/platform/queries";
import { rotateVaultSecrets } from "../src/modules/platform/rotation";
import {
  createPlatformUser,
  resetPlatformUserTwoFactor,
  unlockPlatformUser,
} from "../src/modules/platform/service";
import { adoptExistingStore, setTenantStatus } from "../src/modules/platform/tenants";

/**
 * Operaciones de la plataforma que se hacen desde el servidor, no desde el panel (el panel no existe todavía la primera
 * vez, y un administrador sin teléfono no puede entrar para pedir que le restablezcan el 2FA).
 *
 *   pnpm platform:create-admin            Crea un superadministrador (pide los datos; sin eco para la contraseña).
 *   pnpm platform:reset-2fa <usuario>     Quita su aplicación de autenticación: configurará una nueva al entrar.
 *   pnpm platform:unlock <usuario>        Levanta el bloqueo por intentos fallidos.
 *   pnpm platform:gen-key                 Imprime una llave maestra nueva para PLATFORM_MASTER_KEY.
 *   pnpm platform:rotate-key              Re-cifra los secretos con la llave maestra actual.
 *   pnpm platform:adopt-store --slug <subdominio> --name "<negocio>" [--email <correo>]
 *                                         Registra la tienda que ya está en uso (DATABASE_URL) como el negocio #1, sin tocar sus datos.
 *   pnpm platform:suspend <subdominio>    Suspende un negocio (muestra "cuenta suspendida"); los datos no se tocan.
 *   pnpm platform:reactivate <subdominio> Lo vuelve a poner en marcha.
 *   pnpm platform:tenants                 Lista los negocios registrados.
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

/** `--nombre valor` de la línea de comandos. */
function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
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
    case "adopt-store": {
      const slug = flag("slug") ?? process.env.TENANT_SLUG;
      const name = flag("name") ?? process.env.TENANT_NAME;
      const databaseUrl = process.env.DATABASE_URL;
      if (!slug || !name) {
        throw new Error(
          'Uso: pnpm platform:adopt-store --slug <subdominio> --name "<nombre del negocio>" [--email <correo>]',
        );
      }
      if (!databaseUrl) {
        throw new Error("Falta DATABASE_URL: es la base de la tienda que se va a registrar.");
      }
      const tenant = await adoptExistingStore(
        { slug, name, ownerEmail: flag("email"), databaseUrl },
        { actor: null },
      );
      const base = process.env.TENANT_BASE_DOMAIN;
      console.log(`Listo: la tienda quedó registrada como el negocio "${tenant.slug}" (#1).`);
      console.log(`Sus datos no se tocaron. Versión de datos: ${tenant.schemaVersion}.`);
      console.log(
        base
          ? `Dirección: ${tenant.slug}.${base} — apunta ahí el DNS y avisa a su personal del cambio de dirección.`
          : "Define TENANT_BASE_DOMAIN para que la tienda se atienda en <subdominio>.<dominio base>.",
      );
      return;
    }
    case "suspend":
    case "reactivate": {
      if (!argument) {
        throw new Error(`Uso: pnpm platform:${command} <subdominio>`);
      }
      await setTenantStatus(
        { slug: argument, status: command === "suspend" ? "SUSPENDED" : "ACTIVE" },
        { actor: null },
      );
      console.log(
        command === "suspend"
          ? `El negocio "${argument}" quedó suspendido. Sus datos no se tocaron.`
          : `El negocio "${argument}" volvió a operar.`,
      );
      console.log("El cambio se nota en segundos (cuando vence la caché del directorio).");
      return;
    }
    case "tenants": {
      const tenants = await listTenants();
      if (tenants.length === 0) {
        console.log("Aún no hay negocios registrados.");
        return;
      }
      for (const tenant of tenants) {
        console.log(
          `${tenant.slug.padEnd(24)} ${tenant.status.padEnd(18)} ${tenant.schemaVersion ?? "-"}  ${tenant.name}`,
        );
      }
      return;
    }
    default:
      throw new Error(
        "Uso: pnpm platform:create-admin | platform:reset-2fa <usuario> | platform:unlock <usuario> | platform:gen-key | platform:rotate-key | platform:adopt-store | platform:suspend <subdominio> | platform:reactivate <subdominio> | platform:tenants",
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
