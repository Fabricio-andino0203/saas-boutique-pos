import { AUTH_LIMITS } from "@/config/constants";
import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  AccountLockedError,
  ForbiddenError,
  InvalidCredentialsError,
  ValidationError,
} from "@/lib/errors";
import { hashSecret, verifySecret } from "@/lib/password";
import { hasCapability, type Role } from "@/lib/permissions";
import { pinSchema } from "@/modules/auth/schemas";
import { generateSessionToken, hashSessionToken } from "@/modules/auth/token";

export type AuthDb = Pick<PrismaClient, "user" | "session">;

export type SessionUser = { id: string; name: string; username: string; role: Role };
/** `mustChangePassword`: la contraseña es temporal; hasta cambiarla no se puede usar nada más (ver `requireSession`). */
export type ActiveSession = { sessionId: string; user: SessionUser; mustChangePassword: boolean };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

let dummyHash: Promise<string> | undefined;

/** Se verifica contra un hash falso cuando el usuario no existe, para que no se note por el tiempo. */
function getDummyHash(): Promise<string> {
  dummyHash ??= hashSecret("contraseña-que-nadie-usa");
  return dummyHash;
}

type Credentialed = { id: string; lockedUntil: Date | null };

/**
 * Verifica una contraseña o un PIN aplicando el bloqueo por intentos fallidos.
 * Éxito: reinicia el contador. Fallo: lo incrementa y, al llegar al límite, bloquea la cuenta.
 */
async function checkSecret(
  user: Credentialed,
  hashed: string | null,
  plain: string,
  now: Date,
  client: AuthDb,
): Promise<void> {
  if (user.lockedUntil && user.lockedUntil > now) {
    throw new AccountLockedError();
  }
  const lockExpired = user.lockedUntil !== null && user.lockedUntil <= now;

  if (hashed && (await verifySecret(hashed, plain))) {
    await client.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null },
    });
    return;
  }

  const updated = await client.user.update({
    where: { id: user.id },
    data: { failedLogins: lockExpired ? 1 : { increment: 1 }, lockedUntil: null },
    select: { failedLogins: true },
  });
  if (updated.failedLogins >= AUTH_LIMITS.maxFailedAttempts) {
    await client.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(now.getTime() + AUTH_LIMITS.lockMinutes * MINUTE_MS) },
    });
    throw new AccountLockedError();
  }
  throw new InvalidCredentialsError();
}

export type LoginInput = {
  username: string;
  password: string;
  ip?: string;
  userAgent?: string;
  now?: Date;
};

export type LoginResult = {
  token: string;
  expires: Date;
  user: SessionUser;
  mustChangePassword: boolean;
};

export async function login(input: LoginInput, client: AuthDb = db): Promise<LoginResult> {
  const now = input.now ?? new Date();
  const user = await client.user.findUnique({
    where: { username: input.username.trim().toLowerCase() },
  });

  if (!user || !user.isActive) {
    await verifySecret(await getDummyHash(), input.password);
    throw new InvalidCredentialsError();
  }

  await checkSecret(user, user.passwordHash, input.password, now, client);
  await client.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });

  const token = generateSessionToken();
  const expires = new Date(now.getTime() + AUTH_LIMITS.sessionHours * HOUR_MS);
  await client.session.create({
    data: {
      sessionToken: hashSessionToken(token),
      userId: user.id,
      expires,
      ip: input.ip,
      userAgent: input.userAgent,
    },
  });

  return {
    token,
    expires,
    user: { id: user.id, name: user.name, username: user.username, role: user.role },
    mustChangePassword: user.mustChangePassword,
  };
}

/** Devuelve la sesión vigente de un token, o `null` si no existe, venció, está inactiva o el usuario se desactivó. */
export async function findSession(
  token: string,
  client: AuthDb = db,
  now: Date = new Date(),
): Promise<ActiveSession | null> {
  const session = await client.session.findUnique({
    where: { sessionToken: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session) {
    return null;
  }

  const idleLimit = new Date(now.getTime() - AUTH_LIMITS.idleMinutes * MINUTE_MS);
  if (session.expires <= now || session.updatedAt < idleLimit || !session.user.isActive) {
    await client.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  if (now.getTime() - session.updatedAt.getTime() > AUTH_LIMITS.touchSeconds * 1000) {
    await client.session.update({ where: { id: session.id }, data: { updatedAt: now } });
  }

  const { user } = session;
  return {
    sessionId: session.id,
    user: { id: user.id, name: user.name, username: user.username, role: user.role },
    mustChangePassword: user.mustChangePassword,
  };
}

export async function revokeSession(token: string, client: AuthDb = db): Promise<void> {
  await client.session.deleteMany({ where: { sessionToken: hashSessionToken(token) } });
}

/** Cierra todas las sesiones de un usuario, salvo (opcionalmente) la que se está usando. */
export async function revokeUserSessions(
  userId: string,
  exceptSessionId?: string,
  client: AuthDb = db,
): Promise<void> {
  await client.session.deleteMany({
    where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
  });
}

export type ChangePasswordInput = {
  userId: string;
  currentPassword: string;
  newPassword: string;
  keepSessionId?: string;
  now?: Date;
};

export async function changePassword(
  input: ChangePasswordInput,
  client: AuthDb = db,
): Promise<void> {
  const now = input.now ?? new Date();
  const user = await client.user.findUnique({ where: { id: input.userId } });
  if (!user || !user.isActive) {
    throw new InvalidCredentialsError();
  }

  await checkSecret(user, user.passwordHash, input.currentPassword, now, client);
  if (input.newPassword === input.currentPassword) {
    throw new ValidationError("The new password must be different from the current one");
  }

  await client.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashSecret(input.newPassword), mustChangePassword: false },
  });
  await revokeUserSessions(user.id, input.keepSessionId, client);
}

/** Guarda el PIN rápido de un usuario (4 a 6 números). */
export async function setPin(userId: string, pin: string, client: AuthDb = db): Promise<void> {
  if (!pinSchema.safeParse(pin).success) {
    throw new ValidationError("PIN must be 4 to 6 digits");
  }
  await client.user.update({ where: { id: userId }, data: { pinHash: await hashSecret(pin) } });
}

/** Valida un PIN con el mismo bloqueo por intentos que la contraseña. */
export async function verifyPin(
  userId: string,
  pin: string,
  client: AuthDb = db,
  now: Date = new Date(),
): Promise<SessionUser> {
  const user = await client.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) {
    throw new InvalidCredentialsError();
  }
  await checkSecret(user, user.pinHash, pin, now, client);
  return { id: user.id, name: user.name, username: user.username, role: user.role };
}

export type SwitchUserInput = {
  username: string;
  pin: string;
  /** La sesión que se está usando: se cierra al entrar la otra persona. */
  currentSessionId?: string;
  ip?: string;
  userAgent?: string;
  now?: Date;
};

/**
 * Cambio rápido de cajero en el mostrador: quien entra escribe su usuario y su PIN (con el mismo bloqueo por
 * intentos que la contraseña) y recibe su propia sesión; la anterior se cierra. Solo para quien puede vender.
 */
export async function switchUserWithPin(
  input: SwitchUserInput,
  client: AuthDb = db,
): Promise<LoginResult> {
  const now = input.now ?? new Date();
  const user = await client.user.findUnique({
    where: { username: input.username.trim().toLowerCase() },
  });
  if (!user || !user.isActive) {
    await verifySecret(await getDummyHash(), input.pin);
    throw new InvalidCredentialsError();
  }
  await checkSecret(user, user.pinHash, input.pin, now, client);
  if (!hasCapability(user.role, "sale.create")) {
    throw new ForbiddenError(`Role ${user.role} lacks capability sale.create`);
  }

  const token = generateSessionToken();
  const expires = new Date(now.getTime() + AUTH_LIMITS.sessionHours * HOUR_MS);
  await client.session.create({
    data: {
      sessionToken: hashSessionToken(token),
      userId: user.id,
      expires,
      ip: input.ip,
      userAgent: input.userAgent,
    },
  });
  if (input.currentSessionId) {
    await client.session.deleteMany({ where: { id: input.currentSessionId } });
  }
  await client.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
  return {
    token,
    expires,
    user: { id: user.id, name: user.name, username: user.username, role: user.role },
    mustChangePassword: user.mustChangePassword,
  };
}
