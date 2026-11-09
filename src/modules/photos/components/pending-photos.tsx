"use client";

import { ImagePlus, X } from "lucide-react";

import { PHOTO_LIMITS } from "@/config/constants";
import { messages } from "@/config/messages.es";

const copy = messages.photos;

/** Una foto elegida que todavía no se sube: el producto aún no existe. */
export type PendingPhoto = { file: File; preview: string };

type PendingPhotosProps = {
  items: PendingPhoto[];
  onChange: (items: PendingPhoto[]) => void;
  disabled?: boolean;
};

/** Las fotos que se eligen mientras se crea un producto; se suben cuando el producto queda guardado. */
export function PendingPhotos({ items, onChange, disabled }: PendingPhotosProps) {
  const room = PHOTO_LIMITS.maxPerProduct - items.length;

  function add(files: FileList | null) {
    const chosen = [...(files ?? [])].slice(0, Math.max(0, room));
    if (chosen.length === 0) {
      return;
    }
    onChange([...items, ...chosen.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
  }

  function remove(index: number) {
    const target = items[index];
    if (target) {
      URL.revokeObjectURL(target.preview);
    }
    onChange(items.filter((_, position) => position !== index));
  }

  return (
    <section aria-labelledby="pending-photos-title" className="space-y-3">
      <div className="space-y-1">
        <h2 id="pending-photos-title" className="text-lg font-medium">
          {copy.wizard.title}
        </h2>
        <p className="text-muted-foreground text-sm">{copy.wizard.hint}</p>
      </div>
      {items.length > 0 ? (
        <ul className="flex flex-wrap gap-3" data-testid="pending-photos">
          {items.map((item, index) => (
            <li key={item.preview} className="relative">
              {/* La vista previa es un archivo local (blob:) todavía sin subir: no hay nada que optimizar. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.preview}
                alt=""
                className="bg-muted h-24 w-20 rounded-md object-cover"
              />
              {index === 0 ? (
                <span className="bg-primary text-primary-foreground absolute bottom-1 left-1 rounded-full px-1.5 py-0.5 text-[0.65rem] font-medium">
                  {copy.main}
                </span>
              ) : null}
              <button
                type="button"
                disabled={disabled}
                aria-label={`${copy.wizard.removeOne} (${index + 1})`}
                onClick={() => remove(index)}
                className="bg-background border-input absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full border shadow-sm"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {room > 0 ? (
        <label className="border-divider hover:bg-muted/50 focus-within:ring-ring/50 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm focus-within:ring-3">
          <ImagePlus className="text-muted-foreground size-5" aria-hidden="true" />
          <span className="font-medium">{copy.wizard.choose}</span>
          <span className="text-muted-foreground text-sm">{copy.limits}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            data-testid="wizard-photo-input"
            disabled={disabled}
            onChange={(event) => {
              add(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      ) : (
        <p className="text-muted-foreground text-sm">{copy.full}</p>
      )}
    </section>
  );
}
