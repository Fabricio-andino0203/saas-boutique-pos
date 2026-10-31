import { controlDb, type ControlDb } from "@/lib/tenancy/control-db";
import { getVault, vaultContext, type Vault } from "@/lib/tenancy/vault";
import { recordPlatformAudit, type PlatformActor } from "@/modules/platform/audit";

export type RotationResult = { rotated: number; alreadyCurrent: number; toVersion: number };

/**
 * Rotación de la llave maestra: vuelve a cifrar con la llave **actual** todos los secretos guardados con una anterior (la
 * credencial de la base de cada negocio y el secreto del 2FA de cada administrador). Es repetible: lo que ya está con la
 * llave actual no se toca. Procedimiento completo en docs/RUNBOOK.md.
 */
export async function rotateVaultSecrets(
  actor: PlatformActor | null,
  client: ControlDb = controlDb,
  vault: Vault = getVault(),
): Promise<RotationResult> {
  let rotated = 0;
  let alreadyCurrent = 0;

  await client.$transaction(
    async (tx) => {
      const tenants = await tx.tenant.findMany({
        where: { dbCredentialEnc: { not: null } },
        select: { id: true, dbCredentialEnc: true },
      });
      for (const tenant of tenants) {
        const envelope = tenant.dbCredentialEnc as string;
        if (!vault.needsRotation(envelope)) {
          alreadyCurrent += 1;
          continue;
        }
        await tx.tenant.update({
          where: { id: tenant.id },
          data: { dbCredentialEnc: vault.rotate(envelope, vaultContext.tenantDatabase(tenant.id)) },
        });
        rotated += 1;
      }

      const users = await tx.platformUser.findMany({
        where: { totpSecretEnc: { not: null } },
        select: { id: true, totpSecretEnc: true },
      });
      for (const user of users) {
        const envelope = user.totpSecretEnc as string;
        if (!vault.needsRotation(envelope)) {
          alreadyCurrent += 1;
          continue;
        }
        await tx.platformUser.update({
          where: { id: user.id },
          data: { totpSecretEnc: vault.rotate(envelope, vaultContext.platformUserTotp(user.id)) },
        });
        rotated += 1;
      }

      await recordPlatformAudit(tx, {
        action: "PLATFORM_KEY_ROTATED",
        actor,
        details: { toVersion: vault.currentVersion, rotated, alreadyCurrent },
      });
    },
    { timeout: 60_000 },
  );

  return { rotated, alreadyCurrent, toVersion: vault.currentVersion };
}
