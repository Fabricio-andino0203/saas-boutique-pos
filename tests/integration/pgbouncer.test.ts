import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ensurePgbouncerAuth } from "@/lib/tenancy/pgbouncer";
import { urlFor, withClient } from "@/lib/tenancy/provision-db";

/**
 * Etapa 6: la parte de Postgres de PgBouncer. PgBouncer le pregunta a Postgres por la contraseña de cada rol de negocio con una
 * cuenta propia que SOLO puede llamar a una función. Aquí se comprueba que la cuenta sirve para eso y para nada más.
 */

const adminUrl = process.env.DATABASE_URL_TEST as string;
const USER = "pgb_prueba";
const FIRST_PASSWORD = "PrimeraClavePgbouncer123456";
const SECOND_PASSWORD = "SegundaClavePgbouncer123456";
const BUSINESS_ROLE = "pgb_negocio_prueba";
const mainAccount = decodeURIComponent(new URL(adminUrl).username);

const asPgbouncer = (password: string) =>
  urlFor(adminUrl, { database: "postgres", user: USER, password });

async function cleanUp(): Promise<void> {
  await withClient(urlFor(adminUrl, { database: "postgres" }), async (admin) => {
    await admin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS pgbouncer.get_auth(TEXT)`);
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS pgbouncer`);
    await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS "${USER}"`);
    await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS "${BUSINESS_ROLE}"`);
  });
}

beforeAll(async () => {
  await cleanUp();
  await withClient(urlFor(adminUrl, { database: "postgres" }), (admin) =>
    admin.$executeRawUnsafe(
      `CREATE ROLE "${BUSINESS_ROLE}" LOGIN PASSWORD 'ClaveDelNegocioDePrueba1234'`,
    ),
  );
}, 60_000);

afterAll(cleanUp, 60_000);

describe("the account PgBouncer uses to ask for passwords", () => {
  it("is created without powers and can look up the password verifier of a business role", async () => {
    await ensurePgbouncerAuth(adminUrl, { user: USER, password: FIRST_PASSWORD });

    const [role] = await withClient(
      urlFor(adminUrl, { database: "postgres" }),
      (admin) =>
        admin.$queryRaw<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean }[]>`
        SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = ${USER}
      `,
    );
    expect(role).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false });

    const rows = await withClient(
      asPgbouncer(FIRST_PASSWORD),
      (client) =>
        client.$queryRaw<{ usename: string; passwd: string }[]>`
        SELECT usename, passwd FROM pgbouncer.get_auth(${BUSINESS_ROLE})
      `,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.usename).toBe(BUSINESS_ROLE);
    expect(rows[0]?.passwd).toMatch(/^SCRAM-SHA-256\$/);
  }, 60_000);

  it("never hands out the verifier of a superuser account", async () => {
    const rows = await withClient(
      asPgbouncer(FIRST_PASSWORD),
      (client) =>
        client.$queryRaw<
          { usename: string }[]
        >`SELECT usename FROM pgbouncer.get_auth(${mainAccount})`,
    );
    expect(rows).toEqual([]);
  });

  it("can do nothing else: no direct look at the password table, no business tables, no new objects", async () => {
    await withClient(asPgbouncer(FIRST_PASSWORD), async (client) => {
      await expect(client.$queryRawUnsafe(`SELECT * FROM pg_shadow`)).rejects.toThrow();
      await expect(
        client.$executeRawUnsafe(`CREATE TABLE pgbouncer.intruso (i int)`),
      ).rejects.toThrow();
      await expect(client.$executeRawUnsafe(`CREATE ROLE intruso`)).rejects.toThrow();
    });
  });

  it("is safe to repeat and changes the password when asked", async () => {
    await ensurePgbouncerAuth(adminUrl, { user: USER, password: SECOND_PASSWORD });
    await withClient(asPgbouncer(SECOND_PASSWORD), (client) => client.$queryRaw`SELECT 1`);
    await expect(
      withClient(asPgbouncer(FIRST_PASSWORD), (client) => client.$queryRaw`SELECT 1`),
    ).rejects.toThrow();
  }, 60_000);

  it("refuses a weak or symbol-laden password before touching the server", async () => {
    await expect(ensurePgbouncerAuth(adminUrl, { user: USER, password: "corta" })).rejects.toThrow(
      /16 y 128/,
    );
    await expect(
      ensurePgbouncerAuth(adminUrl, { user: USER, password: "tiene'comilla'y-simbolos-1234567" }),
    ).rejects.toThrow(/16 y 128/);
  });
});
