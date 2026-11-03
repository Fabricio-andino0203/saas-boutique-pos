/**
 * La entrada del menú que corresponde a la pantalla abierta: la de dirección más larga que sea su inicio. Así «/caja/cierres»
 * marca «Cierres de caja» y no «Caja», y «/» solo marca «Inicio» cuando la pantalla es exactamente el inicio.
 */
export function activeHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    const matches =
      href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (best === null || href.length > best.length)) {
      best = href;
    }
  }
  return best;
}
