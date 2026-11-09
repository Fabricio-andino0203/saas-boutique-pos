"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { notFound } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { MoneyInput } from "@/components/shared/money-input";
import { Notice } from "@/components/shared/notice";
import { PageHeader } from "@/components/shared/page-header";
import { SuccessCheck } from "@/components/shared/success-check";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { messages } from "@/config/messages.es";
import { formatMoney } from "@/lib/format";

const gallery = messages.dev.gallery;

type Row = { product: string; priceCents: number };

const columns: ColumnDef<Row>[] = [
  { accessorKey: "product", header: gallery.table.columnProduct },
  {
    accessorKey: "priceCents",
    header: gallery.table.columnPrice,
    cell: ({ row }) => <span className="money block">{formatMoney(row.original.priceCents)}</span>,
  },
];

const sampleRows: Row[] = [
  { product: gallery.table.sampleDress, priceCents: 65000 },
  { product: gallery.table.sampleBlouse, priceCents: 32000 },
];

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function ComponentGalleryPage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_COMPONENT_GALLERY !== "enabled"
  ) {
    notFound();
  }

  const [cents, setCents] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <PageHeader title={gallery.title} description={gallery.description} />

      <Section id="money-input" title={gallery.money.title}>
        <label htmlFor="monto" className="block text-sm font-medium">
          {gallery.money.label}
        </label>
        <MoneyInput id="monto" valueCents={cents} onValueChange={setCents} />
      </Section>

      <Section id="confirm-dialog" title={gallery.confirm.open}>
        <Button onClick={() => setConfirmOpen(true)}>{gallery.confirm.open}</Button>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={gallery.confirm.title}
          description={gallery.confirm.description}
          confirmLabel={gallery.confirm.confirm}
          destructive
          onConfirm={() => setConfirmOpen(false)}
        />
      </Section>

      <Section id="table-loading" title={gallery.table.loading}>
        <DataTable columns={columns} data={[]} isLoading caption={gallery.table.loading} />
      </Section>

      <Section id="table-empty" title={gallery.table.empty}>
        <DataTable
          columns={columns}
          data={[]}
          caption={gallery.table.empty}
          empty={{
            title: messages.states.empty.title,
            action: <Button variant="outline">{gallery.table.emptyAction}</Button>,
          }}
        />
      </Section>

      <Section id="table-error" title={gallery.table.error}>
        <DataTable
          columns={columns}
          data={[]}
          caption={gallery.table.error}
          error={{ message: gallery.table.errorMessage, onRetry: () => undefined }}
        />
      </Section>

      <Section id="table-rows" title={gallery.table.rows}>
        <DataTable columns={columns} data={sampleRows} caption={gallery.table.rows} />
      </Section>

      <Section id="feedback-buttons" title={gallery.feedback.buttons}>
        <div className="flex flex-wrap items-center gap-3">
          <Button>{gallery.feedback.primary}</Button>
          <Button variant="outline">{gallery.feedback.outline}</Button>
          <Button variant="secondary">{gallery.feedback.secondary}</Button>
          <Button variant="ghost">{gallery.feedback.ghost}</Button>
          <Button variant="destructive">{gallery.feedback.destructive}</Button>
          <Button loading>{gallery.feedback.loading}</Button>
          <Button disabled>{gallery.feedback.disabled}</Button>
        </div>
      </Section>

      <Section id="feedback-notices" title={gallery.feedback.notices}>
        <div className="space-y-2">
          <Notice tone="error">{gallery.feedback.noticeError}</Notice>
          <Notice tone="success">{gallery.feedback.noticeSuccess}</Notice>
          <Notice tone="warning">{gallery.feedback.noticeWarning}</Notice>
          <Notice tone="info">{gallery.feedback.noticeInfo}</Notice>
          <Notice tone="info" size="sm">
            {gallery.feedback.noticeSmall}
          </Notice>
        </div>
      </Section>

      <Section id="feedback-toasts" title={gallery.feedback.toasts}>
        <Button variant="outline" onClick={() => toast.success(gallery.feedback.toastMessage)}>
          {gallery.feedback.toastSuccess}
        </Button>
      </Section>

      <Section id="feedback-loading" title={gallery.feedback.loadingBlocks}>
        <div className="space-y-2">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Section>

      <Section id="feedback-success" title={gallery.feedback.success}>
        <SuccessCheck />
      </Section>
    </div>
  );
}
