/** Una foto de un producto, tal como la ven las pantallas (sin nada del servidor, para poder usarla también en el navegador). */
export type ProductPhoto = {
  id: string;
  productId: string;
  colorId: string | null;
  colorName: string | null;
  colorHex: string | null;
  position: number;
  width: number;
  height: number;
  bytes: number;
  originalName: string | null;
};

/** A qué producto pertenece un archivo según su nombre (carga masiva). Ver `file-names.ts`. */
export type FileMatch =
  | {
      matched: true;
      name: string;
      productId: string;
      productName: string;
      code: string;
      /** El color de la foto si el nombre lo decía y el producto lo tiene. */
      colorId: string | null;
      colorName: string | null;
    }
  | { matched: false; name: string };

/** Un producto en el módulo de fotos. */
export type PhotoProductRow = {
  id: string;
  code: string;
  name: string;
  coverImageId: string | null;
  photoCount: number;
};
