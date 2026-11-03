"use client";

import { ImagePlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Notice } from "@/components/shared/notice";
import { PHOTO_LIMITS } from "@/config/constants";
import { messages } from "@/config/messages.es";
import { cn } from "@/lib/utils";
import { uploadProductPhoto } from "@/modules/photos/client";
import { ProductThumb } from "@/modules/photos/components/product-thumb";
import type { PhotoProductRow } from "@/modules/photos/types";

const copy = messages.photos.bulk.card;

/** Un producto en el módulo de fotos: su foto, cuántas tiene y un botón para agregar más sin salir de la lista. */
export function ProductPhotoCard({ product }: { product: PhotoProductRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const room = PHOTO_LIMITS.maxPerProduct - product.photoCount;

  async function add(list: FileList | null) {
    const files = [...(list ?? [])].slice(0, Math.max(0, room));
    if (files.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setProblem(null);
    for (const file of files) {
      const result = await uploadProductPhoto(product.id, file);
      if (!result.ok) {
        setProblem(result.message);
        break;
      }
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <li className="space-y-2" data-testid="photo-card">
      <Link
        href={`/productos/${product.id}`}
        aria-label={`${copy.open}: ${product.name}`}
        className="block"
      >
        <ProductThumb
          imageId={product.coverImageId}
          size="medium"
          className="aspect-[4/5] w-full"
        />
      </Link>
      <div className="space-y-0.5">
        <p className="line-clamp-2 text-sm leading-tight font-medium">{product.name}</p>
        <p className="text-muted-foreground font-mono text-xs">{product.code}</p>
        <p
          className={cn(
            "text-xs",
            product.photoCount === 0 ? "text-warning" : "text-muted-foreground",
          )}
        >
          {product.photoCount === 0
            ? copy.none
            : product.photoCount === 1
              ? copy.one
              : `${product.photoCount} ${copy.many}`}
        </p>
      </div>
      {room > 0 ? (
        <label
          className={cn(
            "border-input hover:bg-muted focus-within:ring-ring/50 inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border px-2.5 text-[0.8rem] focus-within:ring-3",
            busy && "pointer-events-none opacity-50",
          )}
        >
          <ImagePlus className="size-3.5" aria-hidden="true" />
          {busy ? messages.photos.status.uploading : copy.add}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            disabled={busy}
            aria-label={`${copy.add}: ${product.name}`}
            data-testid="card-photo-input"
            onChange={(event) => {
              void add(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      ) : null}
      {problem ? (
        <Notice tone="error" size="sm">
          {problem}
        </Notice>
      ) : null}
    </li>
  );
}
