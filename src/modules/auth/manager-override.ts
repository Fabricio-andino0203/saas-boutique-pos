import { db } from "@/lib/db";
import { ForbiddenError, InvalidCredentialsError } from "@/lib/errors";
import { canManagerPinOverride, hasCapability, type Capability } from "@/lib/permissions";
import { verifyPin, type AuthDb, type SessionUser } from "@/modules/auth/service";

/**
 * Un gerente (o el propietario) autoriza con su PIN algo que el cajero no puede hacer solo. Solo sirve para las
 * capacidades marcadas en `MANAGER_PIN_OVERRIDES`, y la persona del PIN debe tener esa capacidad.
 * El PIN usa el mismo bloqueo por intentos que el inicio de sesión (5 fallos, 15 minutos).
 *
 * Debe llamarse FUERA de la transacción de la operación: si esta se revierte, el conteo de intentos fallidos
 * también se revertiría y el bloqueo no funcionaría.
 */
export async function authorizeWithManagerPin(
  capability: Capability,
  input: { username: string; pin: string },
  client: AuthDb = db,
): Promise<SessionUser> {
  if (!canManagerPinOverride(capability)) {
    throw new ForbiddenError(`${capability} cannot be authorized with a PIN`);
  }
  const user = await client.user.findUnique({
    where: { username: input.username.trim().toLowerCase() },
    select: { id: true },
  });
  if (!user) {
    throw new InvalidCredentialsError();
  }
  const authorizer = await verifyPin(user.id, input.pin, client);
  if (!hasCapability(authorizer.role, capability)) {
    throw new ForbiddenError(`Role ${authorizer.role} lacks capability ${capability}`);
  }
  return authorizer;
}
