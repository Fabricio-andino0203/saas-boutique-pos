"use client";

import { ArrowLeft, ArrowRight, ImagePlus, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/shared/notice";
import { PHOTO_LIMITS } from "@/config/constants";
import { messages } from "@/config/messages.es";
import { cn } from "@/lib/utils";
import {
  removePhotoAction,
  reorderPhotosAction,
  setPhotoColorAction,
} from "@/modules/photos/actions";
import { uploadProductPhoto } from "@/modules/photos/client";
import { ProductThumb } from "@/modules/photos/components/product-thumb";
import type { ProductPhoto } from "@/modules/photos/types";

const copy = messages.photos;

type UploadItem = {
  key: string;
  name: string;
  status: "waiting" | "uploading" | "done" | "failed" | "skipped";
  message?: string;
};

type PhotoGalleryProps = {
  productId: string;
  photos: ProductPhoto[];
  /** Los colores que tiene el producto: una foto puede ser de uno de ellos. */
  colors: { id: string; name: string }[];
};

/** Las fotos de un producto en su ficha: subir, ordenar, elegir la principal, asignar a un color y quitar. */
export function PhotoGallery({ productId, photos, colors }: PhotoGalleryProps) {
  const router = useRouter();
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [feedback, setFeedback] = useState<{ error?: string; success?: string } | null>(null);
  const [removing, setRemoving] = useState<ProductPhoto | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();

  const room = Math.max(0, PHOTO_LIMITS.maxPerProduct - photos.length);
  const uploading = queue.some((item) => item.status === "waiting" || item.status === "uploading");
  const blocked = uploading || pending;

  function patch(key: string, change: Partial<UploadItem>) {
    setQueue((current) =>
      current.map((item) => (item.key === key ? { ...item, ...change } : item)),
    );
  }

  async function addFiles(list: Iterable<File>) {
    const files = [...list];
    if (files.length === 0 || blocked) {
      return;
    }
    setFeedback(null);
    const stamp = Date.now();
    const items: UploadItem[] = files.map((file, index) => ({
      key: `${stamp}-${index}`,
      name: file.name,
      status: index < room ? "waiting" : "skipped",
      message: index < room ? undefined : copy.status.skipped,
    }));
    setQueue(items);
    for (const [index, file] of files.slice(0, room).entries()) {
      const key = items[index]?.key as string;
      patch(key, { status: "uploading" });
      const result = await uploadProductPhoto(productId, file);
      patch(key, result.ok ? { status: "done" } : { status: "failed", message: result.message });
    }
    setQueue((current) => current.filter((item) => item.status !== "done"));
    router.refresh();
  }

  function applyOrder(ids: string[]) {
    startTransition(async () => {
      const result = await reorderPhotosAction(productId, ids);
      setFeedback(result ?? null);
      if (result?.success) {
        router.refresh();
      }
    });
  }

  function move(from: number, to: number) {
    const ids = photos.map((photo) => photo.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id as string);
    applyOrder(ids);
  }

  function changeColor(photo: ProductPhoto, colorId: string) {
    startTransition(async () => {
      const result = await setPhotoColorAction(photo.id, colorId === "" ? null : colorId);
      setFeedback(result ?? null);
      if (result?.success) {
        router.refresh();
      }
    });
  }

  function confirmRemove() {
    const target = removing;
    if (!target) {
      return;
    }
    startTransition(async () => {
      const result = await removePhotoAction(target.id);
      setFeedback(result ?? null);
      setRemoving(null);
      if (result?.success) {
        router.refresh();
      }
    });
  }

  return (
    <section aria-labelledby="photos-title" className="space-y-4" data-testid="photo-gallery">
      <div className="space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 id="photos-title" className="text-lg font-medium">
            {copy.title}
          </h2>
          <span className="text-muted-foreground text-sm tabular-nums" data-testid="photo-count">
            {photos.length} {copy.of} {PHOTO_LIMITS.maxPerProduct}
          </span>
        </div>
        <p className="text-muted-foreground text-sm">{copy.description}</p>
      </div>

      {photos.length === 0 ? (
        <div className="space-y-1">
          <p className="font-medium">{copy.empty.title}</p>
          <p className="text-muted-foreground text-sm">{copy.empty.description}</p>
        </div>
      ) : (
        <ul
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
          data-testid="photo-list"
        >
          {photos.map((photo, index) => (
            <li key={photo.id} className="space-y-2" data-testid="photo-item">
              <div className="relative">
                <ProductThumb
                  imageId={photo.id}
                  size="medium"
                  className="bg-muted aspect-[4/5] w-full object-contain"
                />
                {index === 0 ? (
                  <span className="bg-primary text-primary-foreground absolute top-2 left-2 rounded-full px-2 py-0.5 text-xs font-medium">
                    {copy.main}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  disabled={blocked || index === 0}
                  aria-label={`${copy.moveEarlier} (${index + 1})`}
                  title={copy.moveEarlier}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowLeft aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  disabled={blocked || index === photos.length - 1}
                  aria-label={`${copy.moveLater} (${index + 1})`}
                  title={copy.moveLater}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowRight aria-hidden="true" />
                </Button>
                {index > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    disabled={blocked}
                    aria-label={`${copy.makeMain} (${index + 1})`}
                    title={copy.makeMain}
                    onClick={() => move(index, 0)}
                  >
                    <Star aria-hidden="true" />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="text-destructive ml-auto"
                  disabled={blocked}
                  aria-label={`${copy.remove} (${index + 1})`}
                  title={copy.remove}
                  onClick={() => setRemoving(photo)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
              {colors.length > 0 ? (
                <NativeSelect
                  aria-label={`${copy.colorLabel} (${index + 1})`}
                  value={photo.colorId ?? ""}
                  disabled={blocked}
                  onChange={(event) => changeColor(photo, event.target.value)}
                >
                  <option value="">{copy.generalColor}</option>
                  {colors.map((color) => (
                    <option key={color.id} value={color.id}>
                      {color.name}
                    </option>
                  ))}
                </NativeSelect>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {room === 0 ? (
        <p className="text-muted-foreground text-sm">{copy.full}</p>
      ) : (
        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void addFiles(event.dataTransfer.files);
          }}
          className={cn(
            "border-divider hover:bg-muted/50 focus-within:ring-ring/50 flex max-w-xl cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-6 py-8 text-center focus-within:ring-3",
            dragging && "border-primary bg-muted/50",
            blocked && "pointer-events-none opacity-50",
          )}
        >
          <ImagePlus className="text-muted-foreground size-8" aria-hidden="true" />
          <span className="font-medium">{copy.add}</span>
          <span className="text-muted-foreground text-sm">{copy.dropHint}</span>
          <span className="text-muted-foreground text-sm">{copy.limits}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            data-testid="photo-input"
            disabled={blocked}
            onChange={(event) => {
              void addFiles(event.target.files ?? []);
              event.target.value = "";
            }}
          />
        </label>
      )}

      {queue.length > 0 ? (
        <ul className="space-y-1 text-sm" aria-live="polite" data-testid="upload-queue">
          {queue.map((item) => (
            <li
              key={item.key}
              className={item.status === "failed" ? "text-destructive" : "text-muted-foreground"}
              role={item.status === "failed" ? "alert" : undefined}
            >
              <span className="text-foreground font-medium">{item.name}</span> ·{" "}
              {copy.status[item.status]}
              {item.message && item.status === "failed" ? `: ${item.message}` : ""}
            </li>
          ))}
        </ul>
      ) : null}

      {feedback?.error ? <Notice tone="error">{feedback.error}</Notice> : null}
      {feedback?.success ? <Notice tone="success">{feedback.success}</Notice> : null}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
          }
        }}
        title={copy.removeDialog.title}
        description={copy.removeDialog.description}
        confirmLabel={copy.removeDialog.confirm}
        destructive
        pending={pending}
        onConfirm={confirmRemove}
      />
    </section>
  );
}
