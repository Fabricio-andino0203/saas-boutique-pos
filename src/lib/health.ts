import { db } from "@/lib/db";

export async function checkDatabase(query: () => Promise<unknown>): Promise<boolean> {
  try {
    await query();
    return true;
  } catch {
    return false;
  }
}

export function createHealthHandler(check: () => Promise<boolean>) {
  return async (): Promise<Response> => {
    const healthy = await check();
    return Response.json({ status: healthy ? "ok" : "error" }, { status: healthy ? 200 : 503 });
  };
}

export function pingDatabase(): Promise<boolean> {
  return checkDatabase(() => db.$queryRaw`select 1`);
}
