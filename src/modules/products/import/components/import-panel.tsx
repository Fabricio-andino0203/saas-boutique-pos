"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { messages } from "@/config/messages.es";
import { confirmImportAction, previewImportAction } from "@/modules/products/import/actions";
import type { ImportActionState, ImportPreview } from "@/modules/products/import/types";

const copy = messages.products.import;

const NEW_LABELS = [
  ["brands", copy.newBrands],
  ["seasons", copy.newSeasons],
  ["suppliers", copy.newSuppliers],
  ["sizes", copy.newSizes],
  ["colors", copy.newColors],
] as const;

export function ImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<ImportActionState | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: (formData: FormData) => Promise<ImportActionState>) {
    if (!file) {
      return;
    }
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      setState(await action(formData));
    });
  }

  const preview: ImportPreview | null = state && "preview" in state ? state.preview : null;
  const done = state && "done" in state ? state.done : null;

  return (
    <div className="space-y-8">
      <section aria-labelledby="import-template" className="space-y-3">
        <h2 id="import-template" className="text-lg font-medium">
          {copy.templateTitle}
        </h2>
        <p className="text-muted-foreground text-sm">{copy.templateHint}</p>
        <div className="flex flex-wrap gap-2">
          <a
            href="/productos/importar/plantilla?formato=xlsx"
            className={buttonVariants({ variant: "outline" })}
            download
          >
            {copy.downloadXlsx}
          </a>
          <a
            href="/productos/importar/plantilla?formato=csv"
            className={buttonVariants({ variant: "outline" })}
            download
          >
            {copy.downloadCsv}
          </a>
        </div>
      </section>

      {done ? (
        <section aria-live="polite" className="space-y-3">
          <p role="status" className="text-success font-medium">
            {copy.done} {done.products} {copy.products}, {done.variants} {copy.variants},{" "}
            {done.units} {copy.units}.
          </p>
          <div className="flex gap-2">
            <Link href="/productos" className={buttonVariants()}>
              {copy.seeProducts}
            </Link>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFile(null);
                setState(null);
              }}
            >
              {copy.another}
            </Button>
          </div>
        </section>
      ) : (
        <>
          <section aria-labelledby="import-file" className="space-y-3">
            <h2 id="import-file" className="text-lg font-medium">
              {copy.fileTitle}
            </h2>
            <div className="max-w-md space-y-1.5">
              <label htmlFor="import-file-input" className="text-sm font-medium">
                {copy.fileLabel}
              </label>
              <Input
                id="import-file-input"
                type="file"
                accept=".csv,.xlsx"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setState(null);
                }}
              />
            </div>
            <Button
              type="button"
              disabled={!file || pending}
              onClick={() => run(previewImportAction)}
            >
              {pending && !preview ? copy.checking : copy.check}
            </Button>
            {state && "error" in state ? (
              <p role="alert" className="text-destructive text-sm">
                {state.error}
              </p>
            ) : null}
          </section>

          {preview ? (
            <section aria-labelledby="import-review" className="space-y-4">
              <h2 id="import-review" className="text-lg font-medium">
                {copy.reviewTitle}
              </h2>
              {preview.costIgnored ? (
                <p role="status" className="bg-muted rounded-lg p-3 text-sm">
                  {copy.costIgnored}
                </p>
              ) : null}

              {preview.problemCount > 0 ? (
                <div className="space-y-3">
                  <p role="alert" className="text-destructive font-medium">
                    {copy.problemsTitle} ({preview.problemCount})
                  </p>
                  <p className="text-muted-foreground text-sm">{copy.problemsHint}</p>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableCaption className="sr-only">{copy.problemsTitle}</TableCaption>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{copy.problemColumns.line}</TableHead>
                          <TableHead>{copy.problemColumns.column}</TableHead>
                          <TableHead>{copy.problemColumns.problem}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.problems.map((item, index) => (
                          <TableRow key={`${item.line}-${item.column}-${index}`}>
                            <TableCell className="tabular-nums">{item.line}</TableCell>
                            <TableCell>{item.column}</TableCell>
                            <TableCell>{item.message}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {preview.problemCount > preview.problems.length ? (
                    <p className="text-muted-foreground text-sm">{copy.moreProblems}</p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="font-medium">
                    {copy.willCreate}: {preview.totals.products} {copy.products},{" "}
                    {preview.totals.variants} {copy.variants}, {preview.totals.units} {copy.units}.
                  </p>
                  {NEW_LABELS.some(([key]) => preview.created[key].length > 0) ? (
                    <div className="space-y-1 text-sm">
                      <p className="font-medium">{copy.alsoCreated}</p>
                      <ul className="text-muted-foreground list-disc pl-5">
                        {NEW_LABELS.filter(([key]) => preview.created[key].length > 0).map(
                          ([key, label]) => (
                            <li key={key}>
                              {label}: {preview.created[key].join(", ")}
                            </li>
                          ),
                        )}
                      </ul>
                    </div>
                  ) : null}
                  <Button type="button" disabled={pending} onClick={() => run(confirmImportAction)}>
                    {pending ? copy.confirming : copy.confirm}
                  </Button>
                </div>
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
