import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { platformCookieName, platformCookieSecure } from "@/lib/platform-cookie";
import {
  findPlatformSession,
  revokePlatformSession,
  type ActivePlatformSession,
  type RequestContext,
} from "@/modules/platform/service";

/**
 * Capa de cookies del panel de la plataforma. La lógica de sesiones vive en `modules/platform/service.ts`; aquí solo se
 * lee y se escribe la cookie. Solo para Server Components y Server Actions.
 */

export async function readPlatformToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(platformCookieName())?.value;
}

/** La sesión **completa** (contraseña y código confirmados), o `null`. */
export const getPlatformSession = cache(async (): Promise<ActivePlatformSession | null> => {
  const token = await readPlatformToken();
  if (!token) {
    return null;
  }
  // La vigencia depende de la hora actual: con Cache Components solo se calcula al atender la petición.
  await connection();
  return findPlatformSession(token);
});

/** Lo que se ve en las pantallas de entrada: la sesión completa o la que solo pasó la contraseña. */
export const getPlatformLoginState = cache(async (): Promise<ActivePlatformSession | null> => {
  const token = await readPlatformToken();
  if (!token) {
    return null;
  }
  await connection();
  return findPlatformSession(token, { allowPending: true });
});

export async function requirePlatformSession(): Promise<ActivePlatformSession> {
  const session = await getPlatformSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export async function setPlatformSessionCookie(token: string, expires: Date): Promise<void> {
  const store = await cookies();
  store.set(platformCookieName(), token, {
    httpOnly: true,
    secure: platformCookieSecure(),
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function clearPlatformSession(context: RequestContext = {}): Promise<void> {
  const store = await cookies();
  const token = store.get(platformCookieName())?.value;
  if (token) {
    await revokePlatformSession(token, context);
  }
  store.delete(platformCookieName());
}
