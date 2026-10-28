import { EmptyState } from "@/components/shared/empty-state";
import { NativeSelect } from "@/components/shared/native-select";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
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
import { requirePageCapability } from "@/lib/auth";
import { reportAccess } from "@/modules/reports/access";
import { RangeFilter } from "@/modules/reports/components/range-filter";
import { getSizeColorMatrix, listReportCategories } from "@/modules/reports/queries";
import { parseRange } from "@/modules/reports/ranges";

const copy = messages.reports.sizes;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function SizesReportPage({
  searchParams,
}: {
  searchParams: Promise<{ rango?: string; desde?: string; hasta?: string; categoria?: string }>;
}) {
  const { user } = await requirePageCapability("report.view");
  const access = reportAccess(user);
  const raw = await searchParams;
  const range = parseRange({
    rango: first(raw.rango),
    desde: first(raw.desde),
    hasta: first(raw.hasta),
  });
  const categories = await listReportCategories();
  const categoryId = categories.some((category) => category.id === first(raw.categoria))
    ? first(raw.categoria)
    : "";

  const matrix = await getSizeColorMatrix(range, access.scope, categoryId || undefined);
  const units = new Map(matrix.cells.map((cell) => [`${cell.sizeId}|${cell.colorId}`, cell.units]));
  const max = Math.max(1, ...matrix.cells.map((cell) => cell.units));

  return (
    <div className="space-y-6">
      <PageHeader title={copy.title} description={messages.reports.index.sizes.description} />
      {access.seesEveryone ? null : (
        <p role="status" className="bg-muted rounded-lg border px-4 py-2 text-sm">
          {messages.reports.onlyMine}
        </p>
      )}
      <RangeFilter
        path="/reportes/tallas"
        range={range}
        params={categoryId ? { categoria: categoryId } : {}}
      />
      <form method="get" action="/reportes/tallas" className="flex flex-wrap items-end gap-3">
        {range.preset ? (
          <input type="hidden" name="rango" value={range.preset} />
        ) : (
          <>
            <input type="hidden" name="desde" value={range.fromKey} />
            <input type="hidden" name="hasta" value={range.toKey} />
          </>
        )}
        <label className="space-y-1 text-sm font-medium">
          {copy.category}
          <NativeSelect name="categoria" defaultValue={categoryId} className="w-56">
            <option value="">{copy.allCategories}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button type="submit" variant="outline">
          {copy.apply}
        </Button>
      </form>

      {matrix.totalUnits === 0 ? (
        <EmptyState title={copy.empty} description={messages.reports.common.emptyHint} />
      ) : (
        <>
          <p className="text-sm">
            <strong className="tabular-nums">{matrix.totalUnits}</strong> {copy.units}
          </p>
          <Table>
            <TableCaption className="sr-only">{copy.title}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.size}</TableHead>
                {matrix.colors.map((color) => (
                  <TableHead key={color.id} className="text-center">
                    <span
                      aria-hidden="true"
                      className="mr-1 inline-block size-2.5 rounded-full border align-middle"
                      style={{ backgroundColor: color.hex ?? "transparent" }}
                    />
                    {color.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrix.sizes.map((size) => (
                <TableRow key={size.id}>
                  <TableCell className="font-medium">{size.name}</TableCell>
                  {matrix.colors.map((color) => {
                    const value = units.get(`${size.id}|${color.id}`) ?? 0;
                    return (
                      <TableCell
                        key={color.id}
                        className="text-center tabular-nums"
                        style={{
                          backgroundColor:
                            value > 0
                              ? `color-mix(in oklab, var(--primary) ${Math.round((value / max) * 55) + 8}%, transparent)`
                              : undefined,
                        }}
                      >
                        {value > 0 ? value : "·"}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-muted-foreground text-sm">{copy.note}</p>
        </>
      )}
    </div>
  );
}
