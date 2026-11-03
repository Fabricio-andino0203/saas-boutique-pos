import { redirect } from "next/navigation";

/** La caja ahora se opera desde Vender (PRD RF-CASH-9): quien llega por un enlace viejo o un favorito aterriza allí. */
export default function CashPage() {
  redirect("/vender");
}
