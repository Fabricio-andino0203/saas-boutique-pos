import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Borra lo que crean las pruebas E2E para no ensuciar la base de desarrollo:
 * usuarios `e2e-*` y registros de catálogo cuyo nombre empieza por "E2E ".
 * Solo toca datos sin historial (la auditoría no se puede borrar y se conserva).
 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no está definida (revisa .env)");
  }
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const named = { name: { startsWith: "E2E " } };

    // Turnos de caja de prueba: los que dejaron un comentario o un movimiento que empieza por "E2E".
    const testShifts = {
      OR: [
        { notes: { startsWith: "E2E" } },
        { movements: { some: { reason: { startsWith: "E2E" } } } },
      ],
    };
    // Un turno con ventas no se puede borrar (las ventas no se borran): se deja aprobado para que no quede como
    // pendiente en la lista del gerente. Los demás se borran con sus movimientos.
    const owner = await client.user.findFirst({
      where: { role: "OWNER", isActive: true },
      select: { id: true },
    });
    if (owner) {
      await client.cashSession.updateMany({
        where: {
          AND: [testShifts, { sales: { some: {} } }, { status: "CLOSED_PENDING_APPROVAL" }],
        },
        data: { status: "CLOSED", approvedById: owner.id },
      });
    }
    // Los ids se leen antes de borrar: sin sus movimientos, la sesión ya no se reconocería como de prueba.
    const shiftIds = (
      await client.cashSession.findMany({
        where: { AND: [testShifts, { sales: { none: {} } }] },
        select: { id: true },
      })
    ).map((shift) => shift.id);
    await client.cashMovement.deleteMany({ where: { cashSessionId: { in: shiftIds } } });
    await client.cashSession.deleteMany({ where: { id: { in: shiftIds } } });

    await client.user.deleteMany({ where: { username: { startsWith: "e2e-" } } });

    // Conteos de las categorías de prueba (sus prendas se cuentan solo ahí).
    const testCategories = await client.category.findMany({ where: named, select: { id: true } });
    await client.stockCount.deleteMany({
      where: { scopeRef: { in: testCategories.map((category) => category.id) } },
    });

    // Recepciones y órdenes de los proveedores de prueba (los movimientos del kardex quedan, solo guardan el id).
    const ofTestSuppliers = { supplier: named };
    await client.goodsReceipt.deleteMany({ where: ofTestSuppliers });
    await client.purchaseOrder.deleteMany({ where: ofTestSuppliers });

    // Un producto con movimientos de inventario no se puede borrar (el kardex es de solo inserción):
    // se archiva. Los demás se borran con sus variantes e historial antes que los catálogos que usaban.
    const products = await client.product.findMany({ where: named, select: { id: true } });
    const productIds = products.map((product) => product.id);
    const moved = await client.stockMovement.findMany({
      where: { variant: { productId: { in: productIds } } },
      distinct: ["variantId"],
      select: { variant: { select: { productId: true } } },
    });
    const keep = [...new Set(moved.map((movement) => movement.variant.productId))];
    const deletable = productIds.filter((id) => !keep.includes(id));
    if (keep.length > 0) {
      const archivedAt = new Date();
      await client.variant.updateMany({ where: { productId: { in: keep } }, data: { archivedAt } });
      await client.product.updateMany({ where: { id: { in: keep } }, data: { archivedAt } });
    }
    const ofProducts = { productId: { in: deletable } };
    await client.priceHistory.deleteMany({
      where: { OR: [ofProducts, { variant: ofProducts }] },
    });
    await client.variant.deleteMany({ where: ofProducts });
    await client.product.deleteMany({ where: { id: { in: deletable } } });

    // Si algún producto archivado todavía usa un catálogo de prueba, ese catálogo se queda.
    const tryDelete = async (run: () => Promise<unknown>): Promise<void> => {
      try {
        await run();
      } catch (error) {
        if (!(
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2003"
        )) {
          throw error;
        }
      }
    };
    // Un rango con facturas emitidas no se puede borrar (las ventas no se borran): solo se desactiva.
    const testRanges = { prefix: { startsWith: "E2E-" } };
    await client.fiscalRange.updateMany({ where: testRanges, data: { isActive: false } });
    await tryDelete(() => client.fiscalRange.deleteMany({ where: testRanges }));
    await tryDelete(() => client.brand.deleteMany({ where: named }));
    await tryDelete(() => client.season.deleteMany({ where: named }));
    await tryDelete(() => client.size.deleteMany({ where: named }));
    await tryDelete(() => client.color.deleteMany({ where: named }));
    await tryDelete(() => client.supplier.deleteMany({ where: named }));
    await tryDelete(() =>
      client.customer.deleteMany({
        where: {
          ...named,
          storeCreditEntries: { none: {} },
          sales: { none: {} },
          returns: { none: {} },
          layaways: { none: {} },
        },
      }),
    );
    await tryDelete(() => client.category.deleteMany({ where: named }));
    // Las que todavía usan productos archivados se archivan para que no ensucien el catálogo.
    await client.category.updateMany({ where: named, data: { archivedAt: new Date() } });
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
