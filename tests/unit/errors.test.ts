import { describe, expect, it, vi } from "vitest";

import { messages } from "@/config/messages.es";
import { ok, toActionResult } from "@/lib/action-result";
import {
  APP_ERROR_CODES,
  AppError,
  CashSessionClosedError,
  CashSessionOpenError,
  CashSessionStateError,
  DiscountNeedsApprovalError,
  InsufficientCashError,
  SaleStateError,
  ReturnPolicyError,
  OverReturnError,
  CustomerInUseError,
  CustomerRequiredError,
  ApprovalRequiredError,
  InsufficientCreditError,
  LayawayDepositError,
  LayawayStateError,
  PhoneTakenError,
  ActiveRangeExistsError,
  FinanceBoxInsufficientError,
  FinanceDrawerEntryError,
  FinanceEntryVoidedError,
  FixedCostPaidError,
  FeatureNotIncludedError,
  PhotoLimitError,
  PlanLimitError,
  ReadOnlyAccountError,
  CountInProgressError,
  CountStateError,
  OrderStateError,
  OverReceiptError,
  CodeTakenError,
  ConflictError,
  AccountLockedError,
  ImageTooLargeError,
  InvalidCodeError,
  InvalidImageError,
  TooManyAttemptsError,
  HasStockError,
  FiscalRangeExhaustedError,
  ForbiddenError,
  InsufficientStockError,
  InvalidCredentialsError,
  ItemInUseError,
  LastOwnerError,
  NameTakenError,
  RangeOverlapError,
  SelfActionError,
  UsernameTakenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@/lib/errors";

const table = [
  { create: () => new ValidationError(), code: "VALIDATION", status: 422 },
  { create: () => new NotFoundError(), code: "NOT_FOUND", status: 404 },
  { create: () => new UnauthorizedError(), code: "UNAUTHORIZED", status: 401 },
  { create: () => new ForbiddenError(), code: "FORBIDDEN", status: 403 },
  { create: () => new ConflictError(), code: "CONFLICT", status: 409 },
  { create: () => new InsufficientStockError(), code: "INSUFFICIENT_STOCK", status: 409 },
  { create: () => new CashSessionClosedError(), code: "CASH_SESSION_CLOSED", status: 409 },
  { create: () => new CashSessionOpenError(), code: "CASH_SESSION_OPEN", status: 409 },
  { create: () => new CashSessionStateError(), code: "CASH_SESSION_STATE", status: 409 },
  { create: () => new InsufficientCashError(), code: "INSUFFICIENT_CASH", status: 409 },
  { create: () => new DiscountNeedsApprovalError(), code: "DISCOUNT_NEEDS_APPROVAL", status: 403 },
  { create: () => new SaleStateError(), code: "SALE_STATE", status: 409 },
  { create: () => new FiscalRangeExhaustedError(), code: "FISCAL_RANGE_EXHAUSTED", status: 409 },
  { create: () => new InvalidCredentialsError(), code: "INVALID_CREDENTIALS", status: 401 },
  { create: () => new AccountLockedError(), code: "ACCOUNT_LOCKED", status: 423 },
  { create: () => new InvalidCodeError(), code: "INVALID_CODE", status: 401 },
  { create: () => new TooManyAttemptsError(), code: "RATE_LIMITED", status: 429 },
  { create: () => new UsernameTakenError(), code: "USERNAME_TAKEN", status: 409 },
  { create: () => new LastOwnerError(), code: "LAST_OWNER", status: 409 },
  { create: () => new SelfActionError(), code: "SELF_ACTION", status: 409 },
  { create: () => new NameTakenError(), code: "NAME_TAKEN", status: 409 },
  { create: () => new ItemInUseError(), code: "ITEM_IN_USE", status: 409 },
  { create: () => new CodeTakenError(), code: "CODE_TAKEN", status: 409 },
  { create: () => new HasStockError(), code: "HAS_STOCK", status: 409 },
  { create: () => new RangeOverlapError(), code: "RANGE_OVERLAP", status: 409 },
  { create: () => new ActiveRangeExistsError(), code: "ACTIVE_RANGE_EXISTS", status: 409 },
  { create: () => new OrderStateError(), code: "ORDER_STATE", status: 409 },
  { create: () => new OverReceiptError(), code: "OVER_RECEIPT", status: 409 },
  { create: () => new CountInProgressError(), code: "COUNT_IN_PROGRESS", status: 409 },
  { create: () => new CountStateError(), code: "COUNT_STATE", status: 409 },
  { create: () => new ReturnPolicyError(), code: "RETURN_POLICY", status: 403 },
  { create: () => new OverReturnError(), code: "OVER_RETURN", status: 409 },
  { create: () => new CustomerRequiredError(), code: "CUSTOMER_REQUIRED", status: 422 },
  { create: () => new ApprovalRequiredError(), code: "APPROVAL_REQUIRED", status: 403 },
  { create: () => new InsufficientCreditError(), code: "INSUFFICIENT_CREDIT", status: 409 },
  { create: () => new LayawayStateError(), code: "LAYAWAY_STATE", status: 409 },
  { create: () => new LayawayDepositError(), code: "LAYAWAY_DEPOSIT", status: 422 },
  { create: () => new PhoneTakenError(), code: "PHONE_TAKEN", status: 409 },
  { create: () => new CustomerInUseError(), code: "CUSTOMER_IN_USE", status: 409 },
  { create: () => new ReadOnlyAccountError(), code: "READ_ONLY", status: 403 },
  {
    create: () => new FeatureNotIncludedError("layaways"),
    code: "FEATURE_NOT_INCLUDED",
    status: 403,
  },
  { create: () => new PlanLimitError("users", 5), code: "PLAN_LIMIT", status: 409 },
  { create: () => new InvalidImageError(), code: "INVALID_IMAGE", status: 422 },
  { create: () => new ImageTooLargeError(), code: "IMAGE_TOO_LARGE", status: 413 },
  { create: () => new PhotoLimitError(), code: "PHOTO_LIMIT", status: 409 },
  { create: () => new FinanceEntryVoidedError(), code: "FINANCE_ENTRY_VOIDED", status: 409 },
  { create: () => new FinanceDrawerEntryError(), code: "FINANCE_DRAWER_ENTRY", status: 409 },
  { create: () => new FixedCostPaidError(), code: "FIXED_COST_PAID", status: 409 },
  {
    create: () => new FinanceBoxInsufficientError(),
    code: "INSUFFICIENT_FINANCE_BOX",
    status: 409,
  },
] as const;

describe("AppError subclasses", () => {
  it.each(table)("$code carries its code and status", ({ create, code, status }) => {
    const error = create();
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(error.name).toBe(error.constructor.name);
  });

  it("covers every code exactly once", () => {
    expect(new Set(APP_ERROR_CODES).size).toBe(APP_ERROR_CODES.length);
    expect(table.map((row) => row.code)).toEqual([...APP_ERROR_CODES]);
  });

  it("keeps the cause passed in the options", () => {
    const cause = new Error("root");
    expect(new ConflictError("x", { cause }).cause).toBe(cause);
  });
});

describe("ActionResult", () => {
  it("ok wraps the data", () => {
    expect(ok(5)).toEqual({ ok: true, data: 5 });
  });

  it("maps an AppError to its dictionary message", async () => {
    const result = await toActionResult(() => {
      throw new ForbiddenError();
    }, messages.errors);
    expect(result).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: messages.errors.FORBIDDEN },
    });
  });

  it("returns the data when the function succeeds, sync or async", async () => {
    expect(await toActionResult(() => 7, messages.errors)).toEqual({ ok: true, data: 7 });
    expect(await toActionResult(async () => "a", messages.errors)).toEqual({
      ok: true,
      data: "a",
    });
  });

  it("hides the text of an unexpected error and reports it", async () => {
    const onUnexpected = vi.fn();
    const result = await toActionResult(
      () => {
        throw new Error("secreto-interno");
      },
      messages.errors,
      onUnexpected,
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "UNEXPECTED", message: messages.errors.UNEXPECTED },
    });
    expect(JSON.stringify(result)).not.toContain("secreto-interno");
    expect(onUnexpected).toHaveBeenCalledTimes(1);
  });
});
