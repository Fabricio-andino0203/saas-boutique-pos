import { PLATFORM_AUTH_LIMITS } from "@/config/constants";
import { platformMessages } from "@/config/messages.platform.es";
import type { ControlDb } from "@/lib/tenancy/control-db";
import { controlDb } from "@/lib/tenancy/control-db";
import {
  AccountLockedError,
  InvalidCodeError,
  InvalidCredentialsError,
  LastOwnerError,
  NotFoundError,
  SelfActionError,
  UnauthorizedError,
  UsernameTakenError,
  ValidationError,
} from "@/lib/errors";
import { hashSecret, verifySecret } from "@/lib/password";
import { generateTotpSecret, otpauthUri, verifyTotp } from "@/lib/totp";
import { getVault, vaultContext } from "@/lib/tenancy/vault";
import { generateSessionToken, hashSessionToken } from "@/modules/auth/token";
import { recordPlatformAudit, type PlatformActor } from "@/modules/platform/audit";
import { changePlatformPasswordSchema, createPlatformUserSchema } from "@/modules/platform/schemas";

type Tx = Parameters<Parameters<ControlDb["$transaction"]>[0]>[0];

export type PlatformSessionUser = {
  id: string;
  username: string;
  name: string;
  /** `true` cuando ya confirmó su aplicación de autenticación al menos una vez. */
  twoFactorEnabled: boolean;
  lastLoginAt: Date | null;
};

export type ActivePlatformSession = {
  sessionId: string;
  /** `false` mientras solo pasó la contraseña: aún no puede ver el panel. */
  mfaVerified: boolean;
  user: PlatformSessionUser;
};

/** Datos de la petición que se anotan en la auditoría y en la sesión. */
export type RequestContext = { ip?: string; userAgent?: string; now?: Date };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const ISSUER = "Boutique Ventas";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

let dummyHash: Promise<string> | undefined;

/** Se verifica contra un hash falso cuando el usuario no existe, para que no se note por el tiempo de respuesta. */
function getDummyHash(): Promise<string> {
  dummyHash ??= hashSecret("contraseña-que-nadie-usa-en-la-plataforma");
  return dummyHash;
}

type UserRow = {
  id: string;
  username: string;
  failedLogins: number;
  lockedUntil: Date | null;
};

function actorOf(user: { id: string; username: string }): PlatformActor {
  return { id: user.id, username: user.username };
}

function assertNotLocked(user: UserRow, now: Date): void {
  if (user.lockedUntil && user.lockedUntil > now) {
    throw new AccountLockedError();
  }
}

/**
 * Anota un intento fallido (contraseña o código) y, al llegar al límite, bloquea la cuenta. Los dos tipos comparten el
 * contador: quien ya tiene la contraseña no puede probar códigos sin límite. El contador solo se reinicia cuando el acceso
 * se completa de verdad (contraseña **y** código), nunca al acertar solo la contraseña.
 */
async function failAttempt(
  user: UserRow,
  kind: "password" | "code",
  now: Date,
  client: ControlDb,
  context: RequestContext,
): Promise<never> {
  const lockExpired = user.lockedUntil !== null && user.lockedUntil <= now;
  const updated = await client.platformUser.update({
    where: { id: user.id },
    data: { failedLogins: lockExpired ? 1 : { increment: 1 }, lockedUntil: null },
    select: { failedLogins: true },
  });
  if (updated.failedLogins >= PLATFORM_AUTH_LIMITS.maxFailedAttempts) {
    const until = new Date(now.getTime() + PLATFORM_AUTH_LIMITS.lockMinutes * MINUTE_MS);
    await client.$transaction(async (tx) => {
      await tx.platformUser.update({ where: { id: user.id }, data: { lockedUntil: until } });
      await recordPlatformAudit(tx, {
        action: "PLATFORM_ACCOUNT_LOCKED",
        actor: actorOf(user),
        targetType: "PlatformUser",
        targetId: user.id,
        details: { until: until.toISOString(), reason: kind },
        ip: context.ip,
      });
    });
    throw new AccountLockedError();
  }
  await recordPlatformAudit(client, {
    action: kind === "password" ? "PLATFORM_LOGIN_FAILED" : "PLATFORM_2FA_FAILED",
    actor: actorOf(user),
    details: { attempts: updated.failedLogins },
    ip: context.ip,
  });
  throw kind === "password" ? new InvalidCredentialsError() : new InvalidCodeError();
}

// ───────────────────────────── Inicio de sesión ─────────────────────────────

export type PasswordLoginInput = RequestContext & { username: string; password: string };
export type PasswordLoginResult = {
  token: string;
  expires: Date;
  /** Qué falta para entrar: configurar el 2FA por primera vez, o escribir el código. */
  next: "enroll" | "verify";
};

/**
 * Primer paso: usuario y contraseña. Si son correctos se abre una sesión **pendiente** (no da acceso al panel) que vence en
 * minutos; el segundo paso (`verifyLoginCode` / `completeEnrollment`) la convierte en una sesión de verdad.
 */
export async function loginWithPassword(
  input: PasswordLoginInput,
  client: ControlDb = controlDb,
): Promise<PasswordLoginResult> {
  const now = input.now ?? new Date();
  const user = await client.platformUser.findUnique({
    where: { username: input.username.trim().toLowerCase() },
  });

  if (!user || !user.isActive) {
    await verifySecret(await getDummyHash(), input.password);
    await recordPlatformAudit(client, {
      action: "PLATFORM_LOGIN_FAILED",
      actor: user ? actorOf(user) : null,
      // No se anota el usuario escrito si no existe: a veces alguien pega ahí su contraseña.
      details: { reason: user ? "inactive" : "unknown_user" },
      ip: input.ip,
    });
    throw new InvalidCredentialsError();
  }

  assertNotLocked(user, now);
  if (!(await verifySecret(user.passwordHash, input.password))) {
    return failAttempt(user, "password", now, client, input);
  }

  // El secreto del 2FA se prepara aquí para que la pantalla de configuración solo tenga que leerlo.
  if (!user.totpEnabledAt && !user.totpSecretEnc) {
    await client.platformUser.updateMany({
      where: { id: user.id, totpSecretEnc: null },
      data: {
        totpSecretEnc: getVault().encrypt(
          generateTotpSecret(),
          vaultContext.platformUserTotp(user.id),
        ),
      },
    });
  }

  const token = generateSessionToken();
  const expires = new Date(now.getTime() + PLATFORM_AUTH_LIMITS.pendingMinutes * MINUTE_MS);
  await client.platformSession.create({
    data: {
      sessionToken: hashSessionToken(token),
      userId: user.id,
      expires,
      ip: input.ip,
      userAgent: input.userAgent,
    },
  });
  return { token, expires, next: user.totpEnabledAt ? "verify" : "enroll" };
}

type PendingSession = {
  id: string;
  user: {
    id: string;
    username: string;
    name: string;
    isActive: boolean;
    totpSecretEnc: string | null;
    totpEnabledAt: Date | null;
    totpLastStep: number | null;
    failedLogins: number;
    lockedUntil: Date | null;
  };
};

/** La sesión pendiente que identifica el token, o `UnauthorizedError` si no existe, venció o ya no es válida. */
async function requirePendingSession(
  token: string,
  now: Date,
  client: ControlDb,
): Promise<PendingSession> {
  const session = await client.platformSession.findUnique({
    where: { sessionToken: hashSessionToken(token) },
    include: { user: true },
  });
  if (
    !session ||
    session.mfaVerifiedAt !== null ||
    session.expires <= now ||
    !session.user.isActive
  ) {
    throw new UnauthorizedError("No pending platform login");
  }
  return session;
}

export type FullLoginResult = {
  token: string;
  expires: Date;
  user: Pick<PlatformSessionUser, "id" | "username" | "name">;
};

/** Cambia la sesión pendiente por una completa con un token **nuevo** (así un token viejo no sirve de nada). */
async function promoteSession(
  tx: Tx,
  pending: PendingSession,
  now: Date,
  context: RequestContext,
): Promise<FullLoginResult> {
  const token = generateSessionToken();
  const expires = new Date(now.getTime() + PLATFORM_AUTH_LIMITS.sessionHours * HOUR_MS);
  await tx.platformSession.deleteMany({ where: { id: pending.id } });
  await tx.platformSession.create({
    data: {
      sessionToken: hashSessionToken(token),
      userId: pending.user.id,
      expires,
      mfaVerifiedAt: now,
      ip: context.ip,
      userAgent: context.userAgent,
    },
  });
  const { id, username, name } = pending.user;
  return { token, expires, user: { id, username, name } };
}

export type VerifyCodeInput = RequestContext & { token: string; code: string };

/** Segundo paso para quien ya configuró su aplicación: valida el código y abre la sesión completa. */
export async function verifyLoginCode(
  input: VerifyCodeInput,
  client: ControlDb = controlDb,
): Promise<FullLoginResult> {
  const now = input.now ?? new Date();
  const pending = await requirePendingSession(input.token, now, client);
  const { user } = pending;
  if (!user.totpEnabledAt || !user.totpSecretEnc) {
    throw new UnauthorizedError("Two-factor is not set up");
  }
  assertNotLocked(user, now);

  const secret = getVault().decrypt(user.totpSecretEnc, vaultContext.platformUserTotp(user.id));
  const verification = verifyTotp(secret, input.code, now, user.totpLastStep);
  if (!verification.ok) {
    return failAttempt(user, "code", now, client, input);
  }

  return client.$transaction(async (tx) => {
    // Compare-and-set: dos peticiones simultáneas con el mismo código no pueden entrar las dos.
    const claimed = await tx.platformUser.updateMany({
      where: {
        id: user.id,
        OR: [{ totpLastStep: null }, { totpLastStep: { lt: verification.step } }],
      },
      data: {
        totpLastStep: verification.step,
        failedLogins: 0,
        lockedUntil: null,
        lastLoginAt: now,
      },
    });
    if (claimed.count === 0) {
      throw new InvalidCodeError("Verification code already used");
    }
    const result = await promoteSession(tx, pending, now, input);
    await recordPlatformAudit(tx, {
      action: "PLATFORM_LOGIN",
      actor: actorOf(user),
      ip: input.ip,
    });
    return result;
  });
}

export type EnrollmentSetup = {
  /** Clave en base32, para teclearla a mano si no se puede escanear. */
  secret: string;
  /** Lo que contiene el código QR. */
  uri: string;
  account: string;
};

/** Datos para configurar la aplicación de autenticación de quien acaba de pasar la contraseña por primera vez. */
export async function getEnrollmentSetup(
  token: string,
  client: ControlDb = controlDb,
  now: Date = new Date(),
): Promise<EnrollmentSetup> {
  const { user } = await requirePendingSession(token, now, client);
  if (user.totpEnabledAt || !user.totpSecretEnc) {
    throw new UnauthorizedError("Two-factor enrollment is not available");
  }
  const secret = getVault().decrypt(user.totpSecretEnc, vaultContext.platformUserTotp(user.id));
  return {
    secret,
    account: user.username,
    uri: otpauthUri({ secret, account: user.username, issuer: ISSUER }),
  };
}

/** Confirma la aplicación de autenticación con su primer código: activa el 2FA y abre la sesión completa. */
export async function completeEnrollment(
  input: VerifyCodeInput,
  client: ControlDb = controlDb,
): Promise<FullLoginResult> {
  const now = input.now ?? new Date();
  const pending = await requirePendingSession(input.token, now, client);
  const { user } = pending;
  if (user.totpEnabledAt || !user.totpSecretEnc) {
    throw new UnauthorizedError("Two-factor enrollment is not available");
  }
  assertNotLocked(user, now);

  const secret = getVault().decrypt(user.totpSecretEnc, vaultContext.platformUserTotp(user.id));
  const verification = verifyTotp(secret, input.code, now);
  if (!verification.ok) {
    return failAttempt(user, "code", now, client, input);
  }

  return client.$transaction(async (tx) => {
    const claimed = await tx.platformUser.updateMany({
      where: { id: user.id, totpEnabledAt: null },
      data: {
        totpEnabledAt: now,
        totpLastStep: verification.step,
        failedLogins: 0,
        lockedUntil: null,
        lastLoginAt: now,
      },
    });
    if (claimed.count === 0) {
      throw new UnauthorizedError("Two-factor was already enabled");
    }
    const result = await promoteSession(tx, pending, now, input);
    await recordPlatformAudit(tx, {
      action: "PLATFORM_2FA_ENABLED",
      actor: actorOf(user),
      targetType: "PlatformUser",
      targetId: user.id,
      ip: input.ip,
    });
    await recordPlatformAudit(tx, { action: "PLATFORM_LOGIN", actor: actorOf(user), ip: input.ip });
    return result;
  });
}

// ───────────────────────────── Sesiones ─────────────────────────────

/**
 * La sesión vigente de un token. Por omisión solo devuelve sesiones **completas** (con el código ya confirmado); con
 * `allowPending` también las que solo pasaron la contraseña. Una sesión vencida, inactiva o de un usuario desactivado se
 * borra y devuelve `null`.
 */
export async function findPlatformSession(
  token: string,
  options: { allowPending?: boolean } = {},
  client: ControlDb = controlDb,
  now: Date = new Date(),
): Promise<ActivePlatformSession | null> {
  const session = await client.platformSession.findUnique({
    where: { sessionToken: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session) {
    return null;
  }
  const mfaVerified = session.mfaVerifiedAt !== null;
  const idleLimit = new Date(now.getTime() - PLATFORM_AUTH_LIMITS.idleMinutes * MINUTE_MS);
  const idle = mfaVerified && session.updatedAt < idleLimit;
  if (session.expires <= now || idle || !session.user.isActive) {
    await client.platformSession.deleteMany({ where: { id: session.id } });
    return null;
  }
  if (!mfaVerified && !options.allowPending) {
    return null;
  }
  if (now.getTime() - session.updatedAt.getTime() > PLATFORM_AUTH_LIMITS.touchSeconds * 1000) {
    await client.platformSession.update({ where: { id: session.id }, data: { updatedAt: now } });
  }
  const { user } = session;
  return {
    sessionId: session.id,
    mfaVerified,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      twoFactorEnabled: user.totpEnabledAt !== null,
      lastLoginAt: user.lastLoginAt,
    },
  };
}

export async function revokePlatformSession(
  token: string,
  context: RequestContext = {},
  client: ControlDb = controlDb,
): Promise<void> {
  const session = await client.platformSession.findUnique({
    where: { sessionToken: hashSessionToken(token) },
    include: { user: { select: { id: true, username: true } } },
  });
  if (!session) {
    return;
  }
  await client.$transaction(async (tx) => {
    await tx.platformSession.deleteMany({ where: { id: session.id } });
    if (session.mfaVerifiedAt) {
      await recordPlatformAudit(tx, {
        action: "PLATFORM_LOGOUT",
        actor: actorOf(session.user),
        ip: context.ip,
      });
    }
  });
}

async function revokeUserSessions(
  userId: string,
  client: Pick<ControlDb, "platformSession">,
  exceptSessionId?: string,
): Promise<void> {
  await client.platformSession.deleteMany({
    where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
  });
}

// ───────────────────────────── Administración de cuentas ─────────────────────────────

export type AdminContext = { actor: PlatformActor | null; ip?: string };

/**
 * Pide de nuevo la contraseña de quien va a hacer algo delicado (agregar o desactivar un administrador, restablecer un 2FA).
 * Un error cuenta como intento fallido con el mismo bloqueo que el inicio de sesión.
 */
export async function confirmActorPassword(
  actorId: string,
  password: string,
  context: RequestContext = {},
  client: ControlDb = controlDb,
): Promise<void> {
  const now = context.now ?? new Date();
  const user = await client.platformUser.findUnique({ where: { id: actorId } });
  if (!user || !user.isActive) {
    throw new InvalidCredentialsError();
  }
  assertNotLocked(user, now);
  if (!(await verifySecret(user.passwordHash, password))) {
    return failAttempt(user, "password", now, client, context);
  }
}

export type CreatePlatformUserInput = { name: string; username: string; password: string };

/** Agrega un superadministrador. Entrará con esta contraseña temporal y configurará su aplicación de autenticación. */
export async function createPlatformUser(
  input: CreatePlatformUserInput,
  context: AdminContext,
  client: ControlDb = controlDb,
): Promise<{ id: string; username: string }> {
  const parsed = createPlatformUserSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const data = parsed.data;
  const passwordHash = await hashSecret(data.password);
  try {
    return await client.$transaction(async (tx) => {
      const user = await tx.platformUser.create({
        data: { name: data.name, username: data.username, passwordHash },
        select: { id: true, username: true },
      });
      await recordPlatformAudit(tx, {
        action: "PLATFORM_USER_CREATED",
        actor: context.actor,
        targetType: "PlatformUser",
        targetId: user.id,
        details: { username: user.username, name: data.name },
        ip: context.ip,
      });
      return user;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new UsernameTakenError();
    }
    throw error;
  }
}

export type PlatformUserSummary = {
  id: string;
  username: string;
  name: string;
  isActive: boolean;
  twoFactorEnabled: boolean;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export async function listPlatformUsers(
  client: ControlDb = controlDb,
): Promise<PlatformUserSummary[]> {
  const users = await client.platformUser.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  return users.map((user) => ({
    id: user.id,
    username: user.username,
    name: user.name,
    isActive: user.isActive,
    twoFactorEnabled: user.totpEnabledAt !== null,
    lockedUntil: user.lockedUntil,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  }));
}

async function loadTarget(tx: Tx, userId: string) {
  const target = await tx.platformUser.findUnique({ where: { id: userId } });
  if (!target) {
    throw new NotFoundError("Platform user not found");
  }
  return target;
}

/** Desactiva o reactiva a un administrador. Nunca a uno mismo, y siempre debe quedar al menos uno activo. */
export async function setPlatformUserActive(
  input: { userId: string; active: boolean },
  context: AdminContext,
  client: ControlDb = controlDb,
): Promise<void> {
  if (context.actor?.id === input.userId) {
    throw new SelfActionError();
  }
  await client.$transaction(async (tx) => {
    // Se bloquean las filas activas: dos desactivaciones simultáneas no pueden dejar la plataforma sin nadie.
    await tx.$queryRaw`SELECT "id" FROM "PlatformUser" WHERE "isActive" = true FOR UPDATE`;
    const target = await loadTarget(tx, input.userId);
    if (target.isActive === input.active) {
      return;
    }
    if (!input.active) {
      const othersActive = await tx.platformUser.count({
        where: { isActive: true, id: { not: target.id } },
      });
      if (othersActive === 0) {
        throw new LastOwnerError();
      }
    }
    await tx.platformUser.update({ where: { id: target.id }, data: { isActive: input.active } });
    if (!input.active) {
      await revokeUserSessions(target.id, tx);
    }
    await recordPlatformAudit(tx, {
      action: input.active ? "PLATFORM_USER_REACTIVATED" : "PLATFORM_USER_DEACTIVATED",
      actor: context.actor,
      targetType: "PlatformUser",
      targetId: target.id,
      details: { username: target.username },
      ip: context.ip,
    });
  });
}

/**
 * Quita la aplicación de autenticación de un administrador (perdió el teléfono): en su próximo acceso configurará una
 * nueva. Cierra sus sesiones.
 */
export async function resetPlatformUserTwoFactor(
  userId: string,
  context: AdminContext,
  client: ControlDb = controlDb,
): Promise<void> {
  await client.$transaction(async (tx) => {
    const target = await loadTarget(tx, userId);
    await tx.platformUser.update({
      where: { id: target.id },
      data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null },
    });
    await revokeUserSessions(target.id, tx);
    await recordPlatformAudit(tx, {
      action: "PLATFORM_2FA_RESET",
      actor: context.actor,
      targetType: "PlatformUser",
      targetId: target.id,
      details: { username: target.username },
      ip: context.ip,
    });
  });
}

/** Levanta el bloqueo por intentos fallidos de una cuenta. */
export async function unlockPlatformUser(
  userId: string,
  context: AdminContext,
  client: ControlDb = controlDb,
): Promise<void> {
  await client.$transaction(async (tx) => {
    const target = await loadTarget(tx, userId);
    await tx.platformUser.update({
      where: { id: target.id },
      data: { failedLogins: 0, lockedUntil: null },
    });
    await recordPlatformAudit(tx, {
      action: "PLATFORM_USER_UNLOCKED",
      actor: context.actor,
      targetType: "PlatformUser",
      targetId: target.id,
      details: { username: target.username },
      ip: context.ip,
    });
  });
}

export type ChangePlatformPasswordInput = {
  userId: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword?: string;
  /** La sesión que se está usando: se conserva; las demás se cierran. */
  keepSessionId?: string;
};

export async function changePlatformPassword(
  input: ChangePlatformPasswordInput,
  context: RequestContext = {},
  client: ControlDb = controlDb,
): Promise<void> {
  const parsed = changePlatformPasswordSchema.safeParse({
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
    confirmPassword: input.confirmPassword ?? input.newPassword,
  });
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? platformMessages.validation.required,
    );
  }
  await confirmActorPassword(input.userId, input.currentPassword, context, client);
  const passwordHash = await hashSecret(parsed.data.newPassword);
  await client.$transaction(async (tx) => {
    const user = await loadTarget(tx, input.userId);
    await tx.platformUser.update({ where: { id: user.id }, data: { passwordHash } });
    await revokeUserSessions(user.id, tx, input.keepSessionId);
    await recordPlatformAudit(tx, {
      action: "PLATFORM_PASSWORD_CHANGED",
      actor: actorOf(user),
      targetType: "PlatformUser",
      targetId: user.id,
      ip: context.ip,
    });
  });
}
