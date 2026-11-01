import "dotenv/config";

import { endOfLocalDay, formatLocalDate, parseLocalDateKey } from "../src/lib/dates";
import { AppError } from "../src/lib/errors";
import { formatMoney, parseMoney } from "../src/lib/format";
import { closeControlDb, controlDb } from "../src/lib/tenancy/control-db";
import {
  assignPlan,
  getTenantBilling,
  listPlans,
  PAYMENT_METHODS,
  registerPayment,
  sweepSubscriptions,
} from "../src/modules/platform/billing";
import { seedExamplePlans } from "../src/modules/platform/example-plans";
import { flagValue, hasFlag, UsageError } from "./lib/tenant-run";

/**
 * Planes, suscripciones y pagos, desde el servidor (lo mismo que el panel, para automatizar o cuando el panel no está a mano).
 * Todo queda en la auditoría de la plataforma como acción del sistema.
 *
 *   pnpm billing:sweep                       Anota los vencimientos (gracia, solo lectura, cancelación) y pide la baja de los cancelados.
 *                                            Se corre una vez al día (ver docs/RUNBOOK.md §15) y al arrancar el contenedor.
 *   pnpm billing:seed-plans                  Crea los planes de ejemplo que falten (Básico, Estándar, Completo).
 *   pnpm billing:plans                       Lista los planes.
 *   pnpm billing:status <slug>               Muestra la suscripción y los últimos pagos de un negocio.
 *   pnpm billing:assign <slug> --plan "<nombre>" --reason "<motivo>" [--paid] [--until AAAA-MM-DD]
 *                                            Le pone plan a un negocio que no tiene (en prueba, o ya vigente con --paid).
 *   pnpm billing:pay <slug> --amount 900.00 --method CASH|TRANSFER|CARD|OTHER [--reference "<ref>"] [--periods N] [--note "<nota>"]
 *                                            Registra un pago y extiende el vencimiento.
 */

const context = { actor: null };
/** Fechas en hora de Honduras, como las muestra el panel. */
const dateFormat = formatLocalDate;

function required(name: string): string {
  const value = flagValue(name);
  if (!value) {
    throw new UsageError(`Falta --${name}. Mira el encabezado de scripts/billing.ts para el uso.`);
  }
  return value;
}

function requireArgument(value: string | undefined, command: string): string {
  if (!value || value.startsWith("--")) {
    throw new UsageError(`Uso: pnpm billing:${command} <subdominio>`);
  }
  return value;
}

function parseUntil(): Date | undefined {
  const raw = flagValue("until");
  if (!raw) {
    return undefined;
  }
  const day = parseLocalDateKey(raw);
  if (!day) {
    throw new UsageError("--until debe ser una fecha AAAA-MM-DD");
  }
  return endOfLocalDay(day);
}

async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2);

  switch (command) {
    case "sweep": {
      const report = await sweepSubscriptions(context);
      for (const item of report.transitions) {
        console.log(`${item.slug.padEnd(24)} ${item.from} → ${item.to}`);
      }
      for (const slug of report.deletionsRequested) {
        console.log(`${slug.padEnd(24)} baja pedida por falta de pago (se cancela con un pago)`);
      }
      console.log(
        `Revisadas ${report.checked} suscripciones: ${report.transitions.length} cambiaron de estado, ${report.deletionsRequested.length} bajas pedidas.`,
      );
      return;
    }
    case "seed-plans": {
      const created = await seedExamplePlans(context);
      console.log(
        created.length > 0
          ? `Planes creados: ${created.join(", ")}. Ajusta precios y límites desde el panel.`
          : "Ya existen los planes de ejemplo: no se creó ninguno.",
      );
      return;
    }
    case "plans": {
      const plans = await listPlans();
      if (plans.length === 0) {
        console.log(
          "No hay planes. Crea los de ejemplo con «pnpm billing:seed-plans» o desde el panel.",
        );
      }
      for (const plan of plans) {
        console.log(
          `${plan.name.padEnd(16)} ${formatMoney(plan.priceCents).padStart(14)} ${plan.interval.padEnd(10)} ${
            plan.isActive ? "activo" : "desactivado"
          }  (${plan.activeSubscriptions} negocios)`,
        );
      }
      return;
    }
    case "status": {
      const slug = requireArgument(argument, "status");
      const billing = await getTenantBilling(slug);
      if (!billing) {
        throw new UsageError(`No existe el negocio "${slug}"`);
      }
      if (!billing.current) {
        console.log(`"${slug}" no tiene plan: se atiende sin restricciones.`);
        return;
      }
      const { current } = billing;
      console.log(
        `${slug}: plan ${current.plan.name}${current.isTrial ? " (prueba)" : ""} — ${current.position.mode} — vence ${dateFormat(
          current.position.periodEnd,
        )}, gracia hasta ${dateFormat(current.position.graceEndsAt)}, cancelación ${dateFormat(
          current.position.readOnlyEndsAt,
        )}`,
      );
      for (const payment of billing.payments.slice(0, 5)) {
        console.log(
          `  pago ${dateFormat(payment.paidAt)} ${formatMoney(payment.amountCents)} ${payment.method} → cubre hasta ${dateFormat(payment.coversUntil)}`,
        );
      }
      return;
    }
    case "assign": {
      const slug = requireArgument(argument, "assign");
      const planName = required("plan");
      const plan = await controlDb.plan.findUnique({ where: { name: planName } });
      if (!plan) {
        throw new UsageError(`No existe el plan "${planName}" (mira «pnpm billing:plans»)`);
      }
      const { periodEnd } = await assignPlan(
        {
          slug,
          planId: plan.id,
          trial: !hasFlag("paid"),
          periodEnd: parseUntil(),
          reason: required("reason"),
        },
        context,
      );
      console.log(`"${slug}" ahora tiene el plan ${plan.name}; vence el ${dateFormat(periodEnd)}.`);
      return;
    }
    case "pay": {
      const slug = requireArgument(argument, "pay");
      const amountCents = parseMoney(required("amount"));
      if (amountCents === null) {
        throw new UsageError("--amount debe ser un monto, p. ej. 900.00");
      }
      const method = required("method").toUpperCase();
      if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
        throw new UsageError(`--method debe ser uno de: ${PAYMENT_METHODS.join(", ")}`);
      }
      const periods = flagValue("periods");
      const result = await registerPayment(
        {
          slug,
          amountCents,
          method: method as (typeof PAYMENT_METHODS)[number],
          reference: flagValue("reference"),
          note: flagValue("note"),
          ...(periods ? { periods: Number(periods) } : {}),
        },
        context,
      );
      console.log(
        `Pago registrado: "${slug}" queda cubierto hasta el ${dateFormat(result.coversUntil)}.${
          result.deletionCancelled
            ? " Se canceló la baja que se había pedido por falta de pago."
            : ""
        }`,
      );
      return;
    }
    default:
      throw new UsageError(
        "Uso: pnpm billing:sweep | seed-plans | plans | status <s> | assign <s> --plan <n> --reason <m> | pay <s> --amount <m> --method <m>",
      );
  }
}

main()
  .catch((error: unknown) => {
    if (error instanceof UsageError || error instanceof AppError) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(() => closeControlDb());
