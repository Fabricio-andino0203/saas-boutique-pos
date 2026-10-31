import { redirect } from "next/navigation";
import { Suspense } from "react";

import { platformMessages } from "@/config/messages.platform.es";
import { getPlatformLoginState } from "@/lib/platform-auth";
import { PlatformLoginForm } from "@/modules/platform/components/login-form";

export default function PlatformLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginCard />
    </Suspense>
  );
}

async function LoginCard() {
  const session = await getPlatformLoginState();
  if (session?.mfaVerified) {
    redirect("/");
  }
  const copy = platformMessages.login;

  return (
    <div className="border-divider bg-card w-full max-w-sm space-y-6 rounded-xl border p-8 shadow-sm">
      <div className="space-y-1 text-center">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
          {platformMessages.app.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="text-muted-foreground text-sm">{copy.description}</p>
      </div>
      <PlatformLoginForm />
    </div>
  );
}
