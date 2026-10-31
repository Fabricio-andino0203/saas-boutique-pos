import { redirect } from "next/navigation";
import { Suspense } from "react";

import { platformMessages } from "@/config/messages.platform.es";
import { getPlatformLoginState } from "@/lib/platform-auth";
import { CodeForm } from "@/modules/platform/components/code-form";
import { platformLogoutAction } from "@/modules/platform/actions";

export default function PlatformVerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyCard />
    </Suspense>
  );
}

async function VerifyCard() {
  const session = await getPlatformLoginState();
  if (!session) {
    redirect("/login");
  }
  if (session.mfaVerified) {
    redirect("/");
  }
  if (!session.user.twoFactorEnabled) {
    redirect("/login/configurar");
  }
  const copy = platformMessages.verify;

  return (
    <div className="border-divider bg-card w-full max-w-sm space-y-6 rounded-xl border p-8 shadow-sm">
      <div className="space-y-1 text-center">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
          {platformMessages.app.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="text-muted-foreground text-sm">{copy.description}</p>
      </div>
      <CodeForm mode="verify" />
      <form action={platformLogoutAction} className="text-center">
        <button type="submit" className="text-muted-foreground text-sm underline">
          {copy.back}
        </button>
      </form>
    </div>
  );
}
