import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/layout/brand-mark";
import { messages } from "@/config/messages.es";
import { getSession } from "@/lib/auth";
import { logoutAction } from "@/modules/auth/actions";
import { ChangePasswordForm } from "@/modules/auth/components/change-password-form";

/**
 * Lo único que se puede hacer al entrar con una contraseña temporal (la puso otra persona: el alta del negocio, el soporte o un
 * gerente). Cualquier otra pantalla o acción del sistema manda aquí hasta que se cambie (ver `requireSession`).
 */
export default function ChangePasswordPage() {
  return (
    <Suspense fallback={null}>
      <ChangePasswordCard />
    </Suspense>
  );
}

async function ChangePasswordCard() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (!session.mustChangePassword) {
    redirect("/cuenta");
  }
  const copy = messages.auth.account.forced;

  return (
    <div className="border-divider bg-card w-full max-w-sm space-y-6 rounded-xl border p-8 shadow-sm">
      <div className="space-y-1 text-center">
        <BrandLogo variant="stacked" className="mb-4" />
        <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="text-muted-foreground text-sm">{copy.description}</p>
      </div>
      <ChangePasswordForm forced />
      <form action={logoutAction} className="text-center">
        <Button type="submit" variant="ghost" size="sm">
          {messages.auth.logout}
        </Button>
      </form>
    </div>
  );
}
