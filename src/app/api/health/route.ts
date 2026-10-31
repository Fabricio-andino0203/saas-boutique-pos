import { connection } from "next/server";

import { checkHealth, createHealthHandler } from "@/lib/health";

const handler = createHealthHandler(checkHealth);

export async function GET(): Promise<Response> {
  await connection();
  return handler();
}
