"use client";

import { ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PHOTO_LIMITS } from "@/config/constants";
import { messages } from "@/config/messages.es";
import { cn } from "@/lib/utils";
import { matchPhotoFilesAction } from "@/modules/photos/actions";
import { uploadProductPhoto } from "@/modules/photos/client";
import { compareFileNames } from "@/modules/photos/file-names";
import type { FileMatch } from "@/modules/photos/types";

const copy = messages.photos.bulk;
const MAX_FILES = 100;

type Status = "waiting" | "uploading" | "done" | "failed";
type Entry = { id: number; file: File; match: FileMatch; status: Status; message?: string };
type Phase = "idle" | "matching" | "review" | "uploading" | "done";

/**
 * Sube las fotos de muchos productos de una vez. El nombre de cada archivo dice de qué producto es (ver `file-names.ts`):
 * primero se muestra a quién se asignaría cada una, y recién entonces, con un clic, se sube. Las fotos de un mismo producto
 * suben en orden de nombre (la primera queda de principal); productos distintos suben a la par.
 */
export function BulkPhotoUpload() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const matched = entries.filter((entry) => entry.match.matched);
  const unmatched = entries.length - matched.length;
  const doneCount = entries.filter((entry) => entry.status === "done").length;
  const failedCount = entries.filter((entry) => entry.status === "failed").length;

  function patch(id: number, change: Partial<Entry>) {
    setEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)),
    );
  }

  async function choose(list: Iterable<File>) {
    const all = [...list].filter((file) => file.type === "" || file.type.startsWith("image/"));
    if (all.length === 0 || phase === "matching" || phase === "uploading") {
      return;
    }
    const files = all.slice(0, MAX_FILES);
    setNotice(all.length > MAX_FILES ? copy.drop.tooMany : null);
    setPhase("matching");
    try {
      const matches = await matchPhotoFilesAction(files.map((file) => file.name));
      setEntries(
        files.map((file, index) => ({
          id: index,
          file,
          match: matches[index] ?? { matched: false, name: file.name },
          status: "waiting",
        })),
      );
      setPhase("review");
    } catch {
      setEntries([]);
      setNotice(copy.matchFailed);
      setPhase("idle");
    }
  }

  async function upload() {
    setPhase("uploading");
    // Un grupo por producto, en orden de nombre; los grupos corren de a `uploadConcurrency`.
    const groups = new Map<string, Entry[]>();
    for (const entry of matched) {
      if (entry.match.matched) {
        groups.set(entry.match.productId, [...(groups.get(entry.match.productId) ?? []), entry]);
      }
    }
    const queue = [...groups.values()].map((group) =>
      [...group].sort((a, b) => compareFileNames(a.file.name, b.file.name)),
    );

    async function worker() {
      for (let group = queue.shift(); group; group = queue.shift()) {
        for (const entry of group) {
          if (!entry.match.matched) {
            continue;
          }
          patch(entry.id, { status: "uploading" });
          const result = await uploadProductPhoto(
            entry.match.productId,
            entry.file,
            entry.match.colorId,
          );
          patch(
            entry.id,
            result.ok ? { status: "done" } : { status: "failed", message: result.message },
          );
        }
      }
    }
    await Promise.all(Array.from({ length: PHOTO_LIMITS.uploadConcurrency }, worker));
    setPhase("done");
    router.refresh();
  }

  function reset() {
    setEntries([]);
    setNotice(null);
    setPhase("idle");
  }

  const working = phase === "matching" || phase === "uploading";

  return (
    <section aria-labelledby="bulk-title" className="space-y-4" data-testid="bulk-upload">
      <h2 id="bulk-title" className="sr-only">
        {copy.drop.title}
      </h2>

      {phase === "idle" || phase === "matching" ? (
        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void choose(event.dataTransfer.files);
          }}
          className={cn(
            "border-divider hover:bg-muted/50 focus-within:ring-ring/50 flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-6 py-8 text-center focus-within:ring-3",
            dragging && "border-primary bg-muted/50",
            working && "pointer-events-none opacity-60",
          )}
        >
          <ImagePlus className="text-muted-foreground size-8" aria-hidden="true" />
          <span className="font-medium">{copy.drop.title}</span>
          <span className="text-muted-foreground max-w-2xl text-sm">{copy.drop.hint}</span>
          <span className="text-primary pt-1 text-sm font-medium underline underline-offset-4">
            {phase === "matching" ? copy.matching : copy.drop.choose}
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            data-testid="bulk-photo-input"
            disabled={working}
            onChange={(event) => {
              void choose(event.target.files ?? []);
              event.target.value = "";
            }}
          />
        </label>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h3 className="text-lg font-medium">
              {phase === "done" ? copy.done : copy.review.title}
            </h3>
            <p className="text-sm tabular-nums" aria-live="polite" data-testid="bulk-summary">
              {phase === "review" ? (
                <>
                  <strong>{matched.length}</strong> {copy.review.ready}
                  {unmatched > 0 ? (
                    <>
                      {" · "}
                      <span className="text-warning">
                        <strong>{unmatched}</strong> {copy.review.unmatched}
                      </span>
                    </>
                  ) : null}
                </>
              ) : phase === "uploading" ? (
                <>
                  {copy.uploading}: {doneCount + failedCount} {copy.of} {matched.length}
                </>
              ) : (
                <>
                  <strong>{doneCount}</strong> {copy.uploaded}
                  {failedCount > 0 ? (
                    <>
                      {" · "}
                      <span className="text-destructive">
                        <strong>{failedCount}</strong> {copy.failed}
                      </span>
                    </>
                  ) : null}
                </>
              )}
            </p>
          </div>
          {unmatched > 0 && phase === "review" ? (
            <p className="text-muted-foreground text-sm">{copy.review.unmatchedHint}</p>
          ) : null}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.review.file}</TableHead>
                  <TableHead>{copy.review.product}</TableHead>
                  <TableHead>{copy.review.color}</TableHead>
                  <TableHead>{copy.review.status}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id} data-testid="bulk-row">
                    <TableCell className="max-w-64 truncate font-mono text-xs">
                      {entry.file.name}
                    </TableCell>
                    {entry.match.matched ? (
                      <>
                        <TableCell>
                          {entry.match.productName}{" "}
                          <span className="text-muted-foreground font-mono text-xs">
                            {entry.match.code}
                          </span>
                        </TableCell>
                        <TableCell>{entry.match.colorName ?? copy.review.general}</TableCell>
                      </>
                    ) : (
                      <TableCell colSpan={2} className="text-warning">
                        {copy.review.noProduct}
                      </TableCell>
                    )}
                    <TableCell
                      className={cn(
                        "text-sm",
                        entry.status === "failed" ? "text-destructive" : "text-muted-foreground",
                      )}
                      role={entry.status === "failed" ? "alert" : undefined}
                    >
                      {!entry.match.matched
                        ? "—"
                        : phase === "review"
                          ? "—"
                          : messages.photos.status[entry.status]}
                      {entry.status === "failed" && entry.message ? `: ${entry.message}` : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex gap-2">
            {phase === "review" ? (
              <>
                <Button type="button" disabled={matched.length === 0} onClick={() => void upload()}>
                  {copy.review.upload} ({matched.length})
                </Button>
                <Button type="button" variant="outline" onClick={reset}>
                  {copy.review.cancel}
                </Button>
              </>
            ) : null}
            {phase === "done" ? (
              <Button type="button" onClick={reset}>
                {copy.again}
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {notice ? (
        <p role="alert" className="text-warning text-sm">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
