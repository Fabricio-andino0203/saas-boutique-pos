import type { PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ConflictError, UsernameTakenError, ValidationError } from "@/lib/errors";
import { hashSecret } from "@/lib/password";
import { createUserSchema } from "@/modules/users/schemas";

export type FirstOwnerInput = {
  name: string;
  username: string;
  password: string;
  pin?: string;
  /** La contraseña es temporal (la puso otra persona, p. ej. el alta automática de un negocio): hay que cambiarla al entrar. */
  mustChangePassword?: boolean;
};

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/**
 * Crea al propietario de una instalación nueva (`pnpm admin:create-owner`). No hay a quién pedirle el permiso
 * `user.manage` —todavía no existe nadie—, así que solo se permite mientras la base no tenga un propietario activo:
 * después, los usuarios se crean desde la pantalla de usuarios.
 */
export async function createFirstOwner(
  input: FirstOwnerInput,
  client: PrismaClient = db,
): Promise<{ id: string }> {
  const parsed = createUserSchema.safeParse({ ...input, role: "OWNER" });
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const data = parsed.data;
  const passwordHash = await hashSecret(data.password);
  const pinHash = data.pin ? await hashSecret(data.pin) : null;

  try {
    return await client.$transaction(async (tx) => {
      if ((await tx.user.count({ where: { role: "OWNER", isActive: true } })) > 0) {
        throw new ConflictError("An active owner already exists");
      }
      const user = await tx.user.create({
        data: {
          name: data.name,
          username: data.username,
          role: "OWNER",
          passwordHash,
          pinHash,
          mustChangePassword: input.mustChangePassword === true,
        },
        select: { id: true },
      });
      await audit.log(tx, {
        userId: user.id,
        action: "USER_CREATED",
        entityType: "User",
        entityId: user.id,
        after: { username: data.username, name: data.name, role: "OWNER" },
        reason: "Propietario inicial de la instalación",
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
