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
