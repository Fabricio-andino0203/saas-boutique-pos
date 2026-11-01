import { describe, expect, it } from "vitest";

import { ReadOnlyAccountError } from "@/lib/errors";
import {
  assertWritable,
  guardCall,
  guardTransactionClient,
  isAllowedInReadOnly,
  isWriteOperation,
} from "@/lib/tenancy/read-only-guard";
import { createTenantResolver } from "@/lib/tenancy/resolver";

type Operation = (...args: unknown[]) => Promise<unknown>;
type FakeModel = Record<"create" | "update" | "updateMany" | "findMany" | "delete", Operation>;
type FakeTx = {
  sale: FakeModel;
  user: FakeModel;
  session: FakeModel;
  auditLog: FakeModel;
  stockMovement: FakeModel;
  $queryRaw: Operation;
  $executeRaw: Operation;
};
type FakeClient = FakeTx & {
  $transaction: (callback: (tx: FakeTx) => unknown) => Promise<unknown>;
};

/** Un modelo falso: cada operación anota quién la pidió y devuelve lo que recibió. */
function delegate(model: string, calls: string[]): FakeModel {
  return new Proxy({} as FakeModel, {
    get:
      (_target, operation) =>
      async (...args: unknown[]) => {
        calls.push(`${model}.${String(operation)}`);
        return { model, operation, args };
      },
  });
}

function fakeClient(): { client: FakeClient; calls: string[] } {
  const calls: string[] = [];
  const tx: FakeTx = {
    sale: delegate("sale", calls),
    user: delegate("user", calls),
    session: delegate("session", calls),
    auditLog: delegate("auditLog", calls),
    stockMovement: delegate("stockMovement", calls),
    $queryRaw: async () => {
      calls.push("$queryRaw");
      return [];
    },
    $executeRaw: async () => {
      calls.push("$executeRaw");
      return 1;
    },
  };
  const client: FakeClient = {
    ...tx,
    $transaction: async (callback) => callback(tx),
  };
  return { client, calls };
}

function resolverFor(readOnly: boolean) {
  const { client, calls } = fakeClient();
  let released = 0;
  const db = createTenantResolver(async () => ({
    client: client as never,
    readOnly,
    release: () => {
      released += 1;
    },
  })) as unknown as FakeClient;
  return { db, calls, released: () => released };
}

describe("what counts as a write", () => {
  it("lists every Prisma operation that changes data", () => {
    for (const operation of [
      "create",
      "createMany",
      "createManyAndReturn",
      "update",
      "updateMany",
      "updateManyAndReturn",
      "upsert",
      "delete",
      "deleteMany",
    ]) {
      expect(isWriteOperation(operation), operation).toBe(true);
    }
    for (const operation of [
      "findMany",
      "findFirst",
      "findUnique",
      "count",
      "aggregate",
      "groupBy",
    ]) {
      expect(isWriteOperation(operation), operation).toBe(false);
    }
  });
});

describe("what a read-only business can still write", () => {
  it("allows signing in and out: sessions, the sign-in counters of the user, and the audit log", () => {
    expect(isAllowedInReadOnly("session", "create", {})).toBe(true);
    expect(isAllowedInReadOnly("session", "deleteMany", {})).toBe(true);
    expect(isAllowedInReadOnly("auditLog", "create", {})).toBe(true);
    expect(
      isAllowedInReadOnly("user", "update", { data: { failedLogins: 0, lockedUntil: null } }),
    ).toBe(true);
    expect(isAllowedInReadOnly("user", "update", { data: { lastLoginAt: new Date() } })).toBe(true);
    expect(isAllowedInReadOnly("user", "update", { data: { passwordHash: "x" } })).toBe(true);
  });

  it("refuses everything that records business data", () => {
    expect(isAllowedInReadOnly("sale", "create", {})).toBe(false);
    expect(isAllowedInReadOnly("stockMovement", "create", {})).toBe(false);
    expect(isAllowedInReadOnly("auditLog", "update", {})).toBe(false);
    expect(isAllowedInReadOnly("auditLog", "delete", {})).toBe(false);
    expect(isAllowedInReadOnly("user", "create", {})).toBe(false);
    expect(isAllowedInReadOnly("user", "delete", {})).toBe(false);
  });

  it("refuses a user update that touches anything besides the sign-in fields", () => {
    expect(isAllowedInReadOnly("user", "update", { data: { role: "OWNER" } })).toBe(false);
    expect(
      isAllowedInReadOnly("user", "update", { data: { isActive: true, failedLogins: 0 } }),
    ).toBe(false);
    expect(isAllowedInReadOnly("user", "update", undefined)).toBe(false);
  });

  it("assertWritable throws ReadOnlyAccountError only for forbidden writes", () => {
    expect(() => assertWritable("sale", "findMany", {})).not.toThrow();
    expect(() => assertWritable("session", "create", {})).not.toThrow();
    expect(() => assertWritable("sale", "create", {})).toThrow(ReadOnlyAccountError);
  });
});

describe("guardCall", () => {
  it("lets reads and raw queries through and returns the arguments untouched", () => {
    const args = [{ where: {} }];
    expect(guardCall(["sale", "findMany"], args)).toBe(args);
    expect(guardCall(["$queryRaw"], args)).toBe(args);
  });

  it("blocks raw writes and batch transactions", () => {
    expect(() => guardCall(["$executeRaw"], [])).toThrow(ReadOnlyAccountError);
    expect(() => guardCall(["$executeRawUnsafe"], [])).toThrow(ReadOnlyAccountError);
    expect(() => guardCall(["$transaction"], [[Promise.resolve()]])).toThrow(ReadOnlyAccountError);
  });

  it("wraps the callback of an interactive transaction so its writes are checked too", async () => {
    const { client } = fakeClient();
    const [wrapped] = guardCall(["$transaction"], [async (tx: FakeTx) => tx.sale.create({})]);
    await expect((wrapped as (tx: unknown) => Promise<unknown>)(client)).rejects.toBeInstanceOf(
      ReadOnlyAccountError,
    );
  });
});

describe("guardTransactionClient", () => {
  it("passes reads and the allowed writes, and blocks the rest, inside a transaction", async () => {
    const { client, calls } = fakeClient();
    const tx = guardTransactionClient(client);
    await tx.sale.findMany();
    await tx.session.create({});
    await tx.$queryRaw();
    expect(calls).toEqual(["sale.findMany", "session.create", "$queryRaw"]);
    expect(() => tx.sale.create({})).toThrow(ReadOnlyAccountError);
    expect(() => tx.$executeRaw()).toThrow(ReadOnlyAccountError);
    expect(calls).toHaveLength(3);
  });
});

describe("the db resolver in read-only mode", () => {
  it("blocks writes before they reach the database", async () => {
    const { db, calls, released } = resolverFor(true);
    await expect(db.sale.create({})).rejects.toBeInstanceOf(ReadOnlyAccountError);
    await expect(db.stockMovement.updateMany({})).rejects.toBeInstanceOf(ReadOnlyAccountError);
    expect(calls).toEqual([]);
    // La conexión se suelta aunque la operación se rechace.
    expect(released()).toBe(2);
  });

  it("still reads, signs in and audits", async () => {
    const { db, calls } = resolverFor(true);
    await db.sale.findMany();
    await db.user.update({ data: { failedLogins: 0, lockedUntil: null } });
    await db.session.create({});
    await db.auditLog.create({});
    expect(calls).toEqual(["sale.findMany", "user.update", "session.create", "auditLog.create"]);
  });

  it("checks the writes made inside an interactive transaction", async () => {
    const { db, calls } = resolverFor(true);
    await expect(
      db.$transaction(async (tx) => {
        await tx.sale.findMany();
        return tx.sale.create({});
      }),
    ).rejects.toBeInstanceOf(ReadOnlyAccountError);
    expect(calls).toEqual(["sale.findMany"]);
  });

  it("does not interfere when the business is not read-only", async () => {
    const { db, calls } = resolverFor(false);
    await db.sale.create({});
    await db.$transaction(async (tx) => tx.stockMovement.create({}));
    expect(calls).toEqual(["sale.create", "stockMovement.create"]);
  });
});
