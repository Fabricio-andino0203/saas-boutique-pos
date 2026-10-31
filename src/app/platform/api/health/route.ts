import { NextResponse, connection } from "next/server";

import { checkPlatformHealth } from "@/modules/platform/health";

/** Estado del servicio de la plataforma (se atiende en `PLATFORM_HOST`). No revela nada más que `ok` o `error`. */
export async function GET() {
  await connection();
  return (await checkPlatformHealth())
    ? NextResponse.json({ status: "ok" })
    : NextResponse.json({ status: "error" }, { status: 503 });
}
