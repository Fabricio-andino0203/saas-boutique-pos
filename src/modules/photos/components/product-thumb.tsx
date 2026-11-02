"use client";

import { Shirt } from "lucide-react";
import { useState } from "react";

import type { PhotoSize } from "@/lib/images";
import { cn } from "@/lib/utils";
import { photoUrl } from "@/modules/photos/urls";

type ProductThumbProps = {
  /** La foto a mostrar, o `null` si el producto no tiene: se ve un recuadro con una prenda. */
  imageId: string | null | undefined;
  size?: PhotoSize;
  /** Tamaño y forma del recuadro (por ejemplo `h-12 w-10`). */
  className?: string;
};

/**
 * La foto de un producto en pequeño. Es decorativa (el nombre del producto siempre está al lado), y si el archivo no se
 * encuentra —una base restaurada sin sus fotos— muestra el mismo recuadro que un producto sin foto en vez de una imagen rota.
 */
export function ProductThumb({ imageId, size = "thumb", className }: ProductThumbProps) {
  const [failedId, setFailedId] = useState<string | null>(null);

  if (!imageId || failedId === imageId) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "bg-muted text-muted-foreground flex shrink-0 items-center justify-center rounded-md",
          className,
        )}
      >
        <Shirt className="size-1/2 max-h-6 max-w-6" />
      </span>
    );
  }
  return (
    // Es un archivo propio, ya reducido y en WebP, de una ruta con sesión: el optimizador de Next no aporta nada aquí.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photoUrl(imageId, size)}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailedId(imageId)}
      className={cn("shrink-0 rounded-md object-cover", className)}
    />
  );
}
