export const APP_ERROR_CODES = [
  "VALIDATION",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CONFLICT",
  "INSUFFICIENT_STOCK",
  "CASH_SESSION_CLOSED",
  "FISCAL_RANGE_EXHAUSTED",
  "INVALID_CREDENTIALS",
  "ACCOUNT_LOCKED",
  "USERNAME_TAKEN",
  "LAST_OWNER",
  "SELF_ACTION",
  "NAME_TAKEN",
  "ITEM_IN_USE",
  "CODE_TAKEN",
  "HAS_STOCK",
  "RANGE_OVERLAP",
  "ACTIVE_RANGE_EXISTS",
  "ORDER_STATE",
  "OVER_RECEIPT",
] as const;

export type ErrorCode = (typeof APP_ERROR_CODES)[number];

type AppErrorOptions = { cause?: unknown };

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, status: number, message: string, options?: AppErrorOptions) {
    super(message, options);
    this.code = code;
    this.status = status;
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", options?: AppErrorOptions) {
    super("VALIDATION", 422, message, options);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found", options?: AppErrorOptions) {
    super("NOT_FOUND", 404, message, options);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required", options?: AppErrorOptions) {
    super("UNAUTHORIZED", 401, message, options);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Not allowed", options?: AppErrorOptions) {
    super("FORBIDDEN", 403, message, options);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict with current state", options?: AppErrorOptions) {
    super("CONFLICT", 409, message, options);
  }
}

export class InsufficientStockError extends AppError {
  constructor(message = "Insufficient stock", options?: AppErrorOptions) {
    super("INSUFFICIENT_STOCK", 409, message, options);
  }
}

export class CashSessionClosedError extends AppError {
  constructor(message = "Cash session is closed", options?: AppErrorOptions) {
    super("CASH_SESSION_CLOSED", 409, message, options);
  }
}

export class FiscalRangeExhaustedError extends AppError {
  constructor(message = "Fiscal range exhausted or expired", options?: AppErrorOptions) {
    super("FISCAL_RANGE_EXHAUSTED", 409, message, options);
  }
}

export class InvalidCredentialsError extends AppError {
  constructor(message = "Invalid credentials", options?: AppErrorOptions) {
    super("INVALID_CREDENTIALS", 401, message, options);
  }
}

export class AccountLockedError extends AppError {
  constructor(message = "Account temporarily locked", options?: AppErrorOptions) {
    super("ACCOUNT_LOCKED", 423, message, options);
  }
}

export class UsernameTakenError extends AppError {
  constructor(message = "Username already taken", options?: AppErrorOptions) {
    super("USERNAME_TAKEN", 409, message, options);
  }
}

export class LastOwnerError extends AppError {
  constructor(message = "At least one active owner must remain", options?: AppErrorOptions) {
    super("LAST_OWNER", 409, message, options);
  }
}

export class SelfActionError extends AppError {
  constructor(message = "Not allowed on your own user", options?: AppErrorOptions) {
    super("SELF_ACTION", 409, message, options);
  }
}

export class NameTakenError extends AppError {
  constructor(message = "Name already exists", options?: AppErrorOptions) {
    super("NAME_TAKEN", 409, message, options);
  }
}

export class ItemInUseError extends AppError {
  constructor(message = "Item is still in use", options?: AppErrorOptions) {
    super("ITEM_IN_USE", 409, message, options);
  }
}

export class CodeTakenError extends AppError {
  constructor(message = "Code already exists", options?: AppErrorOptions) {
    super("CODE_TAKEN", 409, message, options);
  }
}

export class HasStockError extends AppError {
  constructor(message = "Item still has stock", options?: AppErrorOptions) {
    super("HAS_STOCK", 409, message, options);
  }
}

export class RangeOverlapError extends AppError {
  constructor(message = "Fiscal range overlaps another one", options?: AppErrorOptions) {
    super("RANGE_OVERLAP", 409, message, options);
  }
}

export class ActiveRangeExistsError extends AppError {
  constructor(message = "An active fiscal range already exists", options?: AppErrorOptions) {
    super("ACTIVE_RANGE_EXISTS", 409, message, options);
  }
}

export class OrderStateError extends AppError {
  constructor(
    message = "The purchase order does not allow this action",
    options?: AppErrorOptions,
  ) {
    super("ORDER_STATE", 409, message, options);
  }
}

export class OverReceiptError extends AppError {
  constructor(message = "Cannot receive more than ordered", options?: AppErrorOptions) {
    super("OVER_RECEIPT", 409, message, options);
  }
}
