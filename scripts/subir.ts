import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

/**
 * Sube los cambios a GitHub con un solo comando: `pnpm subir "qué cambió"`.
 *
 * Hace lo mismo que se haría a mano (revisar, `git add`, `git commit`, `git push`) pero con protecciones:
 * - Se niega si GitHub tiene cambios que esta rama no tiene (nunca fuerza nada).
 * - Se niega a subir llaves, archivos `.env`, respaldos o archivos enormes.
 * - Enseña qué se va a subir y avisa si incluye migraciones de base de datos.
 * - Pregunta una vez antes de subir (`--si` se salta la pregunta).
 *
 * Cada subida a `main` hace que Railway reconstruya y arranque el servicio (docs/PLANTILLA_ACTUALIZACION.md).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REMOTE = "origin";
const TARGET_BRANCH = "main";
const REMOTE_REF = `${REMOTE}/${TARGET_BRANCH}`;
const MAX_FILE_BYTES = 5_000_000;
const SHOWN_FILES = 15;
const MIN_MESSAGE_LENGTH = 4;

const HELP = `Sube los cambios a GitHub.

  pnpm subir "qué cambió"            sube todo con ese mensaje
  pnpm subir                         te pregunta qué cambió
  pnpm subir --si "qué cambió"       sin pedir confirmación
  pnpm subir --verificar "..."       antes corre tipos, lint y formato

Ejemplo de mensaje: fix(caja): el saldo anterior ya no se puede cambiar`;

const FLAGS = ["--si", "--verificar", "--ayuda"] as const;

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: number) => (text: string) =>
  useColor ? `\u001b[${code}m${text}\u001b[0m` : text;
const bold = paint(1);
const dim = paint(2);
const red = paint(31);
const green = paint(32);
const yellow = paint(33);

/** Un motivo claro para no seguir: se muestra el mensaje solo, sin la traza del error. */
class Stop extends Error {}

type GitResult = { ok: boolean; out: string; err: string };

function git(args: string[]): GitResult {
  const result = spawnSync("git", ["-c", "core.quotepath=off", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) {
    throw new Stop(
      "No encuentro git en este equipo. Instálalo desde git-scm.com y vuelve a intentar.",
    );
  }
  return {
    ok: result.status === 0,
    out: (result.stdout ?? "").trimEnd(),
    err: (result.stderr ?? "").trim(),
  };
}

/** Nombres que devuelve un comando con `-z` (separados por NUL, sin comillas ni acentos rotos). */
function gitNames(args: string[]): string[] {
  return git([...args, "-z"])
    .out.split("\0")
    .filter((name) => name.length > 0);
}

function parseArgs(argv: string[]): { message: string; flags: Set<string> } {
  const flags = new Set<string>();
  const words: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      if (!(FLAGS as readonly string[]).includes(arg)) {
        throw new Stop(`No conozco «${arg}».\n\n${HELP}`);
      }
      flags.add(arg);
    } else {
      words.push(arg);
    }
  }
  // Sin comillas también funciona: `pnpm subir arreglo de la caja`
  const message = words
    .join(" ")
    .trim()
    .replace(/^["'«“]+|["'»”]+$/g, "")
    .trim();
  return { message, flags };
}

/** Una sola entrada de teclado para todo el comando: abrir y cerrar varias pierde lo que ya se tecleó. */
let keyboard: Interface | undefined;

/** Pregunta algo; si se cierra el teclado a medias (Ctrl+C), el comando se cancela en vez de quedarse callado. */
async function ask(question: string): Promise<string> {
  keyboard ??= createInterface({ input: process.stdin, output: process.stdout });
  const input = keyboard;
  return new Promise<string>((resolve, reject) => {
    const onClose = () => reject(new Stop("Cancelado. No se subió nada."));
    input.once("close", onClose);
    input.question(question).then((answer) => {
      input.off("close", onClose);
      resolve(answer.trim());
    }, reject);
  });
}

const BLOCKED: { matches: (file: string) => boolean; why: string }[] = [
  {
    matches: (file) => /(^|\/)\.env(\.|$)/.test(file) && !file.endsWith(".example"),
    why: "es un archivo de claves (.env)",
  },
  {
    matches: (file) =>
      /\.(pem|key|p12|pfx)$/i.test(file) || /(^|\/)id_(rsa|ed25519|ecdsa)/.test(file),
    why: "parece una llave privada",
  },
  {
    matches: (file) => /\.(dump|bak|backup)$/i.test(file) || file.startsWith("backups/"),
    why: "parece un respaldo de la base de datos",
  },
];

/** Qué archivos recién preparados no deben subirse, y por qué. */
function findProblems(staged: string[]): string[] {
  const problems: string[] = [];
  for (const file of staged) {
    const blocked = BLOCKED.find((rule) => rule.matches(file));
    if (blocked) {
      problems.push(`${file}: ${blocked.why}`);
      continue;
    }
    try {
      const size = statSync(path.join(ROOT, file)).size;
      if (size > MAX_FILE_BYTES) {
        problems.push(`${file}: pesa ${(size / 1_000_000).toFixed(1)} MB (el máximo es 5 MB)`);
      }
    } catch {
      // Un archivo que ya no existe no pesa nada
    }
  }
  return problems;
}

function runChecks(): void {
  for (const script of ["typecheck", "lint", "format:check"]) {
    console.log(dim(`\n> pnpm ${script}`));
    // Con shell (pnpm es un .cmd en Windows) el comando va completo en un texto: pasar argumentos aparte está desaconsejado.
    const result = spawnSync(`pnpm ${script}`, { cwd: ROOT, stdio: "inherit", shell: true });
    if (result.status !== 0) {
      throw new Stop(`Falló «pnpm ${script}». No se subió nada: corrígelo y vuelve a intentar.`);
    }
  }
}

/** Una línea de `git status --short` en palabras: «nuevo  src/app.ts». */
function describeChange(line: string): string {
  const code = line.slice(0, 2);
  const file = line.slice(3);
  const label =
    code.includes("?") || code.includes("A")
      ? "nuevo"
      : code.includes("D")
        ? "borrado"
        : code.includes("R")
          ? "renombrado"
          : "cambiado";
  return `${label.padEnd(10)} ${file}`;
}

function listFiles(lines: string[]): void {
  for (const line of lines.slice(0, SHOWN_FILES)) {
    console.log(`   ${describeChange(line)}`);
  }
  if (lines.length > SHOWN_FILES) {
    console.log(dim(`   …y ${lines.length - SHOWN_FILES} más`));
  }
}

/** Hay cambios preparados (`git add`) que todavía no se guardaron en un commit: si algo falla, se sueltan. */
let prepared = false;

async function run(): Promise<void> {
  const { message: given, flags } = parseArgs(process.argv.slice(2));
  if (flags.has("--ayuda")) {
    console.log(HELP);
    return;
  }

  const branch = git(["branch", "--show-current"]).out.trim();
  if (!branch) {
    throw new Stop("No estás en una rama (la copia está «suelta»). No se sube nada.");
  }

  console.log(dim("Revisando GitHub…"));
  const fetched = git(["fetch", REMOTE, TARGET_BRANCH, "--quiet"]);
  if (!fetched.ok) {
    throw new Stop(
      `No pude hablar con GitHub. Revisa tu internet y vuelve a intentar.\n${fetched.err}`,
    );
  }
  if (!git(["merge-base", "--is-ancestor", REMOTE_REF, "HEAD"]).ok) {
    throw new Stop(
      `GitHub tiene cambios que esta rama no tiene (${REMOTE_REF}). No se sube nada para no pisarlos.\n` +
        "Pídele a Claude que los junte antes de subir.",
    );
  }

  const pending = git(["status", "--short", "-uall"]).out.split("\n").filter(Boolean);
  const alreadyCommitted = Number(git(["rev-list", "--count", `${REMOTE_REF}..HEAD`]).out) || 0;
  if (pending.length === 0 && alreadyCommitted === 0) {
    console.log(green("Todo está al día: no hay nada nuevo que subir."));
    return;
  }

  let message = given;
  if (pending.length > 0) {
    if (!message) {
      if (!process.stdin.isTTY) {
        throw new Stop('Falta el mensaje: pnpm subir "qué cambió"');
      }
      message = await ask(bold("¿Qué cambió? ") + dim("(una frase) ") + "› ");
    }
    if (message.length < MIN_MESSAGE_LENGTH) {
      throw new Stop("El mensaje es muy corto. Cuenta en una frase qué cambió.");
    }
  }

  if (flags.has("--verificar")) {
    runChecks();
  }

  let staged: string[] = [];
  if (pending.length > 0) {
    git(["add", "-A"]);
    prepared = true;
    staged = gitNames(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
    const problems = findProblems(staged);
    if (problems.length > 0) {
      throw new Stop(
        `${red("No se sube nada:")} hay archivos que no deben ir a GitHub.\n` +
          problems.map((problem) => `   ${problem}`).join("\n") +
          "\nSácalos de la carpeta (o pídele a Claude que los ignore) y vuelve a intentar.",
      );
    }
  }

  const hasNewCommit = pending.length > 0 && git(["diff", "--cached", "--quiet"]).ok === false;
  if (pending.length > 0 && !hasNewCommit && alreadyCommitted === 0) {
    console.log(green("Todo está al día: los cambios no alteran ningún archivo."));
    return;
  }

  const everything = gitNames(["diff", "--cached", "--name-only", REMOTE_REF]);
  const hasMigrations = everything.some((file) => /(^|\/)migrations\/.+\.sql$/.test(file));

  console.log(`\n${bold("Se va a subir")}  ${branch}  →  ${TARGET_BRANCH} de GitHub`);
  if (hasNewCommit) {
    console.log(`\n${bold(`Cambios nuevos (${pending.length}):`)}`);
    listFiles(pending);
    console.log(`\n${bold("Mensaje:")} ${message}`);
  }
  if (alreadyCommitted > 0) {
    console.log(`\nAdemás van ${alreadyCommitted} commit(s) que ya estaban hechos.`);
  }
  if (hasMigrations) {
    console.log(
      yellow(
        "\nIncluye migraciones de base de datos: al desplegar se aplican solas en todos los negocios.",
      ),
    );
  }

  if (!flags.has("--si")) {
    if (!process.stdin.isTTY) {
      throw new Stop("Sin teclado no puedo preguntar. Usa --si para subir sin confirmar.");
    }
    const answer = (
      await ask(`\n${bold("¿Subir ahora?")} ${dim("(Enter = sí, n = cancelar)")} › `)
    ).toLowerCase();
    if (!["", "s", "si", "sí", "y", "yes"].includes(answer)) {
      console.log("Cancelado. No se subió nada.");
      return;
    }
  }

  if (hasNewCommit) {
    const commit = git(["commit", "-m", message]);
    if (!commit.ok) {
      throw new Stop(`No pude guardar los cambios (commit):\n${commit.err || commit.out}`);
    }
    prepared = false;
  }

  console.log(dim("\nSubiendo…"));
  const pushed = spawnSync("git", ["push", REMOTE, `HEAD:${TARGET_BRANCH}`], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (pushed.status !== 0) {
    throw new Stop(
      `${red("No se pudo subir.")} Tus cambios quedaron guardados aquí (nada se perdió).\n` +
        "Revisa el mensaje de arriba y vuelve a correr `pnpm subir`: sube lo que falta.",
    );
  }

  const hash = git(["rev-parse", "--short", "HEAD"]).out.trim();
  console.log(`\n${green("Listo.")} Subido a GitHub (${hash}).`);
  console.log(
    "Railway empieza a desplegar en unos segundos. Los pasos para revisarlo están en docs/PLANTILLA_ACTUALIZACION.md.",
  );
}

async function main(): Promise<void> {
  try {
    await run();
  } finally {
    if (prepared) {
      git(["reset", "-q"]);
    }
  }
}

main()
  .catch((error: unknown) => {
    if (error instanceof Stop) {
      console.error(`\n${error.message}`);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(() => keyboard?.close());
