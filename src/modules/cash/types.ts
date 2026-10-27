export type CashActionState = { error?: string; success?: string } | undefined;

export type CashCloseState = { error: string } | { id: string };

export type CashPreviewState =
  { error: string } | { expectedCents: number; differenceCents: number };
