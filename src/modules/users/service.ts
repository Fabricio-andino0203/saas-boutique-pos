import type { PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { assertWithinPlanLimit } from "@/lib/entitlements";
import {
  LastOwnerError,
  NotFoundError,
  SelfActionError,
  UsernameTakenError,
  ValidationError,
} from "@/lib/errors";
import { hashSecret } from "@/lib/password";
import { requireCapability, type Role } from "@/lib/permissions";
import {
  createUserSchema,
  resetPasswordSchema,
  resetPinSchema,
  updateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from "@/modules/users/schemas";

export type Actor = { id: string; role: Role };

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function parseOrThrow<T>(
  result: { success: true; data: T } | { success: false; error: { issues: { message: string }[] } },
): T {
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message ?? "Invalid input");
  }
  return result.data;
}

async function otherActiveOwners(tx: Tx, excludeId: string): Promise<number> {
  return tx.user.count({ where: { role: "OWNER", isActive: true, id: { not: excludeId } } });
}

export async function listUsers(client: PrismaClient = db) {
  return client.user.findMany({
    orderBy: [{ name: "asc" }, { username: "asc" }],
    select: {
      id: true,
      name: true,
      username: true,
      role: true,
      isActive: true,
      lockedUntil: true,
      lastLoginAt: true,
    },
  });
}

/** Usuarios que cuentan para el límite del plan: los activos (los archivados no). */
export async function countActiveUsers(client: PrismaClient = db): Promise<number> {
  return client.user.count({ where: { isActive: true } });
}

export async function getUser(id: string, client: PrismaClient = db) {
  return client.user.findUnique({
    where: { id },
    select: { id: true, name: true, username: true, role: true, isActive: true },
  });
}

export async function createUser(
  actor: Actor,
  input: CreateUserInput,
  client: PrismaClient = db,
): Promise<{ id: string }> {
  requireCapability(actor, "user.manage");
  const data = parseOrThrow(createUserSchema.safeParse(input));
  const passwordHash = await hashSecret(data.password);
  const pinHash = data.pin ? await hashSecret(data.pin) : null;

  try {
    return await client.$transaction(async (tx) => {
      await assertWithinPlanLimit("users", () => tx.user.count({ where: { isActive: true } }));
      const user = await tx.user.create({
        data: { name: data.name, username: data.username, role: data.role, passwordHash, pinHash },
        select: { id: true },
      });
      await audit.log(tx, {
        userId: actor.id,
        action: "USER_CREATED",
        entityType: "User",
        entityId: user.id,
        after: { username: data.username, name: data.name, role: data.role },
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

export async function updateUser(
  actor: Actor,
  id: string,
  input: UpdateUserInput,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "user.manage");
  const data = parseOrThrow(updateUserSchema.safeParse(input));

  await client.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id } });
    if (!target) {
      throw new NotFoundError();
    }
    const roleChanged = target.role !== data.role;
    if (roleChanged) {
      if (actor.id === id) {
        throw new SelfActionError();
      }
      if (target.role === "OWNER" && target.isActive && (await otherActiveOwners(tx, id)) === 0) {
        throw new LastOwnerError();
      }
    }
    await tx.user.update({ where: { id }, data: { name: data.name, role: data.role } });
    if (roleChanged) {
      await audit.log(tx, {
        userId: actor.id,
        action: "PERMISSION_CHANGED",
        entityType: "User",
        entityId: id,
        before: { role: target.role },
        after: { role: data.role },
      });
    }
  });
}

export async function setUserActive(
  actor: Actor,
  id: string,
  active: boolean,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "user.manage");

  await client.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id } });
    if (!target) {
      throw new NotFoundError();
    }
    if (target.isActive === active) {
      return;
    }
    if (!active) {
      if (actor.id === id) {
        throw new SelfActionError();
      }
      if (target.role === "OWNER" && (await otherActiveOwners(tx, id)) === 0) {
        throw new LastOwnerError();
      }
    }
    if (active) {
      await assertWithinPlanLimit("users", () => tx.user.count({ where: { isActive: true } }));
    }
    await tx.user.update({ where: { id }, data: { isActive: active } });
    if (!active) {
      await tx.session.deleteMany({ where: { userId: id } });
    }
    await audit.log(tx, {
      userId: actor.id,
      action: active ? "USER_REACTIVATED" : "USER_DEACTIVATED",
      entityType: "User",
      entityId: id,
      before: { isActive: target.isActive },
      after: { isActive: active },
    });
  });
}

/** Restablece la contraseña de otra persona, la desbloquea y cierra sus sesiones. */
export async function resetPassword(
  actor: Actor,
  id: string,
  newPassword: string,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "user.manage");
  const data = parseOrThrow(resetPasswordSchema.safeParse({ newPassword }));
  if (actor.id === id) {
    throw new SelfActionError();
  }
  const passwordHash = await hashSecret(data.newPassword);

  await client.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) {
      throw new NotFoundError();
    }
    await tx.user.update({
      where: { id },
      data: { passwordHash, failedLogins: 0, lockedUntil: null },
    });
    await tx.session.deleteMany({ where: { userId: id } });
    await audit.log(tx, {
      userId: actor.id,
      action: "CREDENTIALS_RESET",
      entityType: "User",
      entityId: id,
      after: { kind: "password" },
    });
  });
}

export async function resetPin(
  actor: Actor,
  id: string,
  pin: string,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "user.manage");
  const data = parseOrThrow(resetPinSchema.safeParse({ pin }));
  const pinHash = await hashSecret(data.pin);

  await client.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) {
      throw new NotFoundError();
    }
    await tx.user.update({ where: { id }, data: { pinHash, failedLogins: 0, lockedUntil: null } });
    await audit.log(tx, {
      userId: actor.id,
      action: "CREDENTIALS_RESET",
      entityType: "User",
      entityId: id,
      after: { kind: "pin" },
    });
  });
}
