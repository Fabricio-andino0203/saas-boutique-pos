import { ReadOnlyAccountError } from "@/lib/errors";

/**
 * Solo lectura (propuesta SaaS §5): cuando la suscripción de un negocio pasó la gracia, el sistema deja **consultar y exportar**
 * pero no registrar nada nuevo. En vez de confiar en que cada pantalla y cada acción lo recuerden, se corta en el único lugar
 * por donde pasa todo el acceso a datos de la aplicación (`db`, ver `resolver.ts`): ninguna escritura sobre datos del negocio
 * llega a la base mientras dure, sin importar qué código la pida.
 */

/** Operaciones de Prisma que escriben. */
const WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

/** Campos de un usuario que cambia el propio inicio de sesión (contador de fallos, bloqueo, último acceso, contraseña). */
const LOGIN_FIELDS: ReadonlySet<string> = new Set([
  "failedLogins",
  "lockedUntil",
  "lastLoginAt",
  "passwordHash",
  "pinHash",
]);

export function isWriteOperation(operation: string): boolean {
  return WRITE_OPERATIONS.has(operation);
}

/**
 * Lo único que se puede escribir en solo lectura: abrir y cerrar sesión (la tabla de sesiones y los contadores del propio
 * usuario), cambiar la propia contraseña y anotar la auditoría. Nada de ventas, inventario, caja, clientes ni catálogo.
 */
export function isAllowedInReadOnly(model: string, operation: string, args: unknown): boolean {
  if (model === "session") {
    return true;
  }
  if (model === "auditLog") {
    return operation === "create";
  }
  if (model === "user" && (operation === "update" || operation === "updateMany")) {
    const data = (args as { data?: Record<string, unknown> } | undefined)?.data;
    return data !== undefined && Object.keys(data).every((field) => LOGIN_FIELDS.has(field));
  }
  return false;
}

export function assertWritable(model: string, operation: string, args: unknown): void {
  if (isWriteOperation(operation) && !isAllowedInReadOnly(model, operation, args)) {
    throw new ReadOnlyAccountError(`Read-only account: ${model}.${operation} is not allowed`);
  }
}

type Delegate = Record<string, (...args: unknown[]) => unknown>;
type TransactionCallback = (tx: unknown) => unknown;

/**
 * Envuelve el cliente de una transacción interactiva para que sus escrituras pasen por la misma regla. (Las llamadas
 * directas a `db.<modelo>.<operación>` se revisan en el resolutor antes de llegar aquí.)
 */
export function guardTransactionClient<T extends object>(tx: T): T {
  return new Proxy(tx, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (typeof property === "symbol") {
        return value;
      }
      if (property === "$executeRaw" || property === "$executeRawUnsafe") {
        return () => {
          throw new ReadOnlyAccountError("Read-only account: raw SQL writes are not allowed");
        };
      }
      if (property.startsWith("$")) {
        return typeof value === "function" ? (value as Delegate[string]).bind(target) : value;
      }
      if (typeof value !== "object" || value === null) {
        return value;
      }
      const delegate = value as Delegate;
      return new Proxy(delegate, {
        get(inner, operation) {
          const original: unknown = Reflect.get(inner, operation);
          if (typeof operation === "symbol" || typeof original !== "function") {
            return original;
          }
          return (...args: unknown[]) => {
            assertWritable(property, operation, args[0]);
            return Reflect.apply(original, inner, args) as unknown;
          };
        },
      });
    },
  });
}

/**
 * Revisa una llamada a `db` (su camino, p. ej. `["sale", "create"]` o `["$transaction"]`) en un negocio en solo lectura y
 * devuelve los argumentos con los que debe ejecutarse: una transacción recibe un cliente vigilado. Lanza si la llamada escribe.
 *
 * Lo que no vigila: `$queryRaw` (se usa para leer y para candados de transacción; una escritura por ahí dentro de una venta
 * quedaría deshecha porque la venta misma fallaría al crear su fila) y lo que ocurra fuera de `db`.
 */
export function guardCall(path: readonly string[], args: unknown[]): unknown[] {
  const [first, second] = path;
  if (path.length === 2 && first !== undefined && second !== undefined && !first.startsWith("$")) {
    assertWritable(first, second, args[0]);
    return args;
  }
  if (path.length === 1 && first === "$transaction") {
    const callback = args[0];
    if (typeof callback !== "function") {
      throw new ReadOnlyAccountError("Read-only account: batch transactions are not allowed");
    }
    return [
      (tx: unknown) => (callback as TransactionCallback)(guardTransactionClient(tx as object)),
      ...args.slice(1),
    ];
  }
  if (path.length === 1 && (first === "$executeRaw" || first === "$executeRawUnsafe")) {
    throw new ReadOnlyAccountError("Read-only account: raw SQL writes are not allowed");
  }
  return args;
}
