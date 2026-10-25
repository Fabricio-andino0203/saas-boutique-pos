export const APP_ERROR_CODES = [
  "VALIDATION",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CONFLICT",
  "INSUFFICIENT_STOCK",
  "CASH_SESSION_CLOSED",
  "FISCAL_RANGE_EXHAUSTED",
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
