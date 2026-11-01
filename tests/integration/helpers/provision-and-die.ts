import "dotenv/config";

import { closeControlDb } from "../../../src/lib/tenancy/control-db";
import {
  startProvisioning,
  type ProvisionStepName,
} from "../../../src/modules/platform/provisioning";

/**
 * Proceso hijo de las pruebas de aprovisionamiento: da de alta un negocio y **se mata a sí mismo con SIGKILL** justo después
 * del paso indicado (sin despedirse: ni «finally», ni cierre de conexiones), como si se cortara la luz a media receta.
 *
 * Variables: PROVISION_SLUG, PROVISION_DIE_AFTER (nombre del paso), PROVISION_OWNER_PASSWORD, TENANT_PROVISIONING_URL y
 * TENANT_TEMPLATE_DB, más las de la base central de pruebas.
 */
async function main(): Promise<void> {
  const slug = process.env.PROVISION_SLUG ?? "";
  const dieAfter = process.env.PROVISION_DIE_AFTER as ProvisionStepName;
  await startProvisioning(
    {
      slug,
      name: `Negocio ${slug}`,
      ownerName: "Dueña de prueba",
      ownerUsername: "duena",
      ownerPassword: process.env.PROVISION_OWNER_PASSWORD ?? "",
    },
    { actor: null },
    {
      hooks: {
        afterStep: (step) => {
          if (step === dieAfter) {
            process.kill(process.pid, "SIGKILL");
          }
        },
      },
    },
  );
  console.log("El proceso no murió: la receta terminó completa");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeControlDb());
