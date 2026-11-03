export const APP_ERROR_CODES = [
  "VALIDATION",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CONFLICT",
  "INSUFFICIENT_STOCK",
  "CASH_SESSION_CLOSED",
  "CASH_SESSION_OPEN",
  "CASH_SESSION_STATE",
  "INSUFFICIENT_CASH",
  "DISCOUNT_NEEDS_APPROVAL",
  "SALE_STATE",
  "FISCAL_RANGE_EXHAUSTED",
  "INVALID_CREDENTIALS",
  "ACCOUNT_LOCKED",
  "INVALID_CODE",
  "RATE_LIMITED",
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
  "COUNT_IN_PROGRESS",
  "COUNT_STATE",
  "RETURN_POLICY",
  "OVER_RETURN",
  "CUSTOMER_REQUIRED",
  "APPROVAL_REQUIRED",
  "INSUFFICIENT_CREDIT",
  "LAYAWAY_STATE",
  "LAYAWAY_DEPOSIT",
  "PHONE_TAKEN",
  "CUSTOMER_IN_USE",
  "READ_ONLY",
  "FEATURE_NOT_INCLUDED",
  "PLAN_LIMIT",
  "INVALID_IMAGE",
  "IMAGE_TOO_LARGE",
  "PHOTO_LIMIT",
  "FINANCE_ENTRY_VOIDED",
  "FINANCE_DRAWER_ENTRY",
  "FIXED_COST_PAID",
  "INSUFFICIENT_FINANCE_BOX",
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
  /** La prenda que no alcanzó, para poder decirle al cajero cuál es. */
  readonly variantId?: string;

  constructor(message = "Insufficient stock", options?: AppErrorOptions & { variantId?: string }) {
    super("INSUFFICIENT_STOCK", 409, message, options);
    this.variantId = options?.variantId;
  }
}

export class CashSessionClosedError extends AppError {
  constructor(message = "Cash session is closed", options?: AppErrorOptions) {
    super("CASH_SESSION_CLOSED", 409, message, options);
  }
}

export class CashSessionOpenError extends AppError {
  constructor(message = "A cash session is already open", options?: AppErrorOptions) {
    super("CASH_SESSION_OPEN", 409, message, options);
  }
}

export class CashSessionStateError extends AppError {
  constructor(message = "The cash session does not allow this action", options?: AppErrorOptions) {
    super("CASH_SESSION_STATE", 409, message, options);
  }
}

export class InsufficientCashError extends AppError {
  constructor(message = "Not enough cash in the drawer", options?: AppErrorOptions) {
    super("INSUFFICIENT_CASH", 409, message, options);
  }
}

export class DiscountNeedsApprovalError extends AppError {
  constructor(message = "The discount is above the allowed limit", options?: AppErrorOptions) {
    super("DISCOUNT_NEEDS_APPROVAL", 403, message, options);
  }
}

export class SaleStateError extends AppError {
  constructor(message = "The sale does not allow this action", options?: AppErrorOptions) {
    super("SALE_STATE", 409, message, options);
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

/** El código de verificación en dos pasos (2FA) está mal, venció o ya se usó. */
export class InvalidCodeError extends AppError {
  constructor(message = "Invalid verification code", options?: AppErrorOptions) {
    super("INVALID_CODE", 401, message, options);
  }
}

/** La suscripción del negocio venció y pasó la gracia: solo se puede consultar y exportar, no registrar nada nuevo. */
export class ReadOnlyAccountError extends AppError {
  constructor(message = "The account is read-only", options?: AppErrorOptions) {
    super("READ_ONLY", 403, message, options);
  }
}

/** La función pedida no está incluida en el plan del negocio. */
export class FeatureNotIncludedError extends AppError {
  readonly feature: string;

  constructor(feature: string, options?: AppErrorOptions) {
    super(
      "FEATURE_NOT_INCLUDED",
      403,
      `The "${feature}" feature is not included in the plan`,
      options,
    );
    this.feature = feature;
  }
}

/** Agregar esto superaría el límite del plan del negocio (usuarios, productos…). */
export class PlanLimitError extends AppError {
  readonly kind: string;
  readonly limit: number;

  constructor(kind: string, limit: number, options?: AppErrorOptions) {
    super("PLAN_LIMIT", 409, `The plan allows at most ${limit} (${kind})`, options);
    this.kind = kind;
    this.limit = limit;
  }
}

export class TooManyAttemptsError extends AppError {
  /** Segundos que faltan para que se pueda volver a intentar. */
  readonly retryAfterSeconds: number;

  constructor(
    message = "Too many failed attempts",
    options?: AppErrorOptions & { retryAfterSeconds?: number },
  ) {
    super("RATE_LIMITED", 429, message, options);
    this.retryAfterSeconds = options?.retryAfterSeconds ?? 0;
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

export class CountInProgressError extends AppError {
  constructor(message = "A stock count is already in progress", options?: AppErrorOptions) {
    super("COUNT_IN_PROGRESS", 409, message, options);
  }
}

export class CountStateError extends AppError {
  constructor(message = "The stock count does not allow this action", options?: AppErrorOptions) {
    super("COUNT_STATE", 409, message, options);
  }
}

export class ReturnPolicyError extends AppError {
  constructor(message = "The return does not meet the return policy", options?: AppErrorOptions) {
    super("RETURN_POLICY", 403, message, options);
  }
}

export class OverReturnError extends AppError {
  constructor(message = "Cannot return more than was sold", options?: AppErrorOptions) {
    super("OVER_RETURN", 409, message, options);
  }
}

export class CustomerRequiredError extends AppError {
  constructor(message = "A customer is required", options?: AppErrorOptions) {
    super("CUSTOMER_REQUIRED", 422, message, options);
  }
}

export class ApprovalRequiredError extends AppError {
  constructor(message = "A manager must authorize this", options?: AppErrorOptions) {
    super("APPROVAL_REQUIRED", 403, message, options);
  }
}

export class InsufficientCreditError extends AppError {
  constructor(message = "Not enough store credit", options?: AppErrorOptions) {
    super("INSUFFICIENT_CREDIT", 409, message, options);
  }
}

export class LayawayStateError extends AppError {
  constructor(message = "The layaway does not allow this action", options?: AppErrorOptions) {
    super("LAYAWAY_STATE", 409, message, options);
  }
}

export class LayawayDepositError extends AppError {
  constructor(message = "The initial deposit is below the minimum", options?: AppErrorOptions) {
    super("LAYAWAY_DEPOSIT", 422, message, options);
  }
}

export class PhoneTakenError extends AppError {
  constructor(message = "A customer with that phone already exists", options?: AppErrorOptions) {
    super("PHONE_TAKEN", 409, message, options);
  }
}

/** El archivo no es una foto que se pueda usar (no es JPG/PNG/WebP, está dañado o tiene demasiados píxeles). */
export class InvalidImageError extends AppError {
  constructor(message = "The file is not a usable image", options?: AppErrorOptions) {
    super("INVALID_IMAGE", 422, message, options);
  }
}

export class ImageTooLargeError extends AppError {
  constructor(message = "The image file is too large", options?: AppErrorOptions) {
    super("IMAGE_TOO_LARGE", 413, message, options);
  }
}

/** El producto ya tiene todas las fotos que se permiten. */
export class PhotoLimitError extends AppError {
  constructor(
    message = "The product already has the maximum number of photos",
    options?: AppErrorOptions,
  ) {
    super("PHOTO_LIMIT", 409, message, options);
  }
}

export class CustomerInUseError extends AppError {
  constructor(message = "The customer still has active layaways", options?: AppErrorOptions) {
    super("CUSTOMER_IN_USE", 409, message, options);
  }
}

/** El movimiento de Finanzas ya estaba anulado. */
export class FinanceEntryVoidedError extends AppError {
  constructor(message = "The finance entry is already voided", options?: AppErrorOptions) {
    super("FINANCE_ENTRY_VOIDED", 409, message, options);
  }
}

/** Un gasto que salió de la caja no se anula desde Finanzas: el efectivo ya salió, se corrige con una entrada de caja. */
export class FinanceDrawerEntryError extends AppError {
  constructor(
    message = "A cash-drawer expense cannot be voided from Finance",
    options?: AppErrorOptions,
  ) {
    super("FINANCE_DRAWER_ENTRY", 409, message, options);
  }
}

/** Se quiso retirar de la caja de finanzas más de lo que hay. */
export class FinanceBoxInsufficientError extends AppError {
  constructor(
    message = "The finance cash box does not have that much cash",
    options?: AppErrorOptions,
  ) {
    super("INSUFFICIENT_FINANCE_BOX", 409, message, options);
  }
}

/** Ese costo fijo ya tiene un pago vigente en ese mes. */
export class FixedCostPaidError extends AppError {
  constructor(
    message = "The fixed cost is already paid for that month",
    options?: AppErrorOptions,
  ) {
    super("FIXED_COST_PAID", 409, message, options);
  }
}
