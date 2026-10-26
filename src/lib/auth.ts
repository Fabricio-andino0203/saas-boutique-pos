import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { env } from "@/lib/env";
import { requireCapability, type Capability } from "@/lib/permissions";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { findSession, revokeSession, type ActiveSession } from "@/modules/auth/service";

/**
 * Capa de cookies del servidor. La lógica de sesiones vive en `modules/auth/service.ts`;
 * aquí solo se lee y se escribe la cookie. Solo para Server Components y Server Actions.
 */
export const getSession = cache(async (): Promise<ActiveSession | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }
  // La vigencia de la sesión depende de la hora actual: con Cache Components eso solo puede
  // calcularse al atender la petición, nunca durante un prerenderizado.
  await connection();
  return findSession(token);
});

export async function requireSession(): Promise<ActiveSession> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

/** Exige sesión y la capacidad indicada; lanza `ForbiddenError` si el rol no la tiene. */
export async function requireUserCapability(capability: Capability): Promise<ActiveSession> {
  const session = await requireSession();
  requireCapability(session.user, capability);
  return session;
}

export async function setSessionCookie(token: string, expires: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await revokeSession(token);
  }
  store.delete(SESSION_COOKIE);
}
