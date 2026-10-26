export type Sample = {
  code: string;
  name: string;
  category: string;
  brand?: string;
  priceCents: number;
  costCents: number;
  sizes: string[];
  colors: string[];
  quantity: number;
};

/** Prendas de ejemplo con códigos `DEMO-NN`, para ver el catálogo y el inventario con datos. */
export const SAMPLE_PRODUCTS: readonly Sample[] = [
  {
    code: "DEMO-01",
    name: "Vestido floral de verano",
    category: "Vestidos",
    brand: "Zara",
    priceCents: 85000,
    costCents: 38000,
    sizes: ["S", "M", "L"],
    colors: ["Rojo", "Azul marino"],
    quantity: 4,
  },
  {
    code: "DEMO-02",
    name: "Blusa de lino",
    category: "Blusas",
    priceCents: 45000,
    costCents: 19000,
    sizes: ["S", "M", "L", "XL"],
    colors: ["Blanco", "Beige"],
    quantity: 6,
  },
  {
    code: "DEMO-03",
    name: "Camisa Oxford",
    category: "Camisas",
    brand: "Zara",
    priceCents: 62000,
    costCents: 27000,
    sizes: ["M", "L", "XL"],
    colors: ["Azul"],
    quantity: 3,
  },
  {
    code: "DEMO-04",
    name: "Jeans slim",
    category: "Mujer",
    priceCents: 72000,
    costCents: 31000,
    sizes: ["S", "M", "L"],
    colors: ["Azul", "Negro"],
    quantity: 5,
  },
  {
    code: "DEMO-05",
    name: "Falda plisada",
    category: "Mujer",
    priceCents: 38000,
    costCents: 15000,
    sizes: ["S", "M"],
    colors: ["Negro", "Beige"],
    quantity: 4,
  },
  {
    code: "DEMO-06",
    name: "Cinturón de cuero",
    category: "Accesorios",
    priceCents: 32000,
    costCents: 14000,
    sizes: [],
    colors: ["Negro", "Café"],
    quantity: 8,
  },
  {
    code: "DEMO-07",
    name: "Bolso de mano",
    category: "Accesorios",
    priceCents: 95000,
    costCents: 42000,
    sizes: [],
    colors: ["Negro", "Rojo"],
    quantity: 3,
  },
  {
    code: "DEMO-08",
    name: "Sandalias de verano",
    category: "Calzado",
    priceCents: 56000,
    costCents: 24000,
    sizes: ["36", "37", "38", "39"],
    colors: ["Beige"],
    quantity: 2,
  },
];
