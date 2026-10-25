import { connection } from "next/server";

import { createHealthHandler, pingDatabase } from "@/lib/health";

const handler = createHealthHandler(pingDatabase);

export async function GET(): Promise<Response> {
  await connection();
  return handler();
}
