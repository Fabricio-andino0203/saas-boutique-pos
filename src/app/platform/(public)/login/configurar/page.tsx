import { redirect } from "next/navigation";
import { Suspense } from "react";

import { platformMessages } from "@/config/messages.platform.es";
import { formatSecretForHumans } from "@/lib/totp";
import { getPlatformLoginState, readPlatformToken } from "@/lib/platform-auth";
import { platformLogoutAction } from "@/modules/platform/actions";
import { CodeForm } from "@/modules/platform/components/code-form";
import { QrCode } from "@/modules/platform/components/qr-code";
import { getEnrollmentSetup } from "@/modules/platform/service";

export default function PlatformEnrollPage() {
  return (
    <Suspense fallback={null}>
      <EnrollCard />
    </Suspense>
  );
}

async function EnrollCard() {
  const session = await getPlatformLoginState();
  if (!session) {
    redirect("/login");
  }
  if (session.mfaVerified) {
    redirect("/");
  }
  if (session.user.twoFactorEnabled) {
    redirect("/login/verificar");
  }
  const token = (await readPlatformToken()) as string;
  const setup = await getEnrollmentSetup(token);
  const copy = platformMessages.enroll;

  return (
    <div className="border-divider bg-card w-full max-w-md space-y-6 rounded-xl border p-8 shadow-sm">
      <div className="space-y-1 text-center">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
          {platformMessages.app.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="text-muted-foreground text-sm">{copy.description}</p>
      </div>
      <div className="space-y-3">
        <p className="text-sm font-medium">{copy.step1}</p>
        <div className="flex justify-center">
          <QrCode value={setup.uri} label={copy.qrLabel} />
        </div>
        <p className="text-muted-foreground text-xs">{copy.manual}</p>
        <p
          className="bg-muted rounded-md px-3 py-2 text-center font-mono text-sm tracking-wider break-all select-all"
          aria-label={copy.secretLabel}
        >
          {formatSecretForHumans(setup.secret)}
        </p>
      </div>
      <div className="space-y-3">
        <p className="text-sm font-medium">{copy.step2}</p>
        <CodeForm mode="enroll" />
      </div>
      <form action={platformLogoutAction} className="text-center">
        <button type="submit" className="text-muted-foreground text-sm underline">
          {platformMessages.verify.back}
        </button>
      </form>
    </div>
  );
}
