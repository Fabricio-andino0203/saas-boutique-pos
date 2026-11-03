import { redirect } from "next/navigation";
import { Suspense } from "react";

import { BrandLogo } from "@/components/layout/brand-mark";
import { messages } from "@/config/messages.es";
import { getSession } from "@/lib/auth";
import { safeNextPath } from "@/lib/session-cookie";
import { LoginForm } from "@/modules/auth/components/login-form";

type LoginPageProps = { searchParams: Promise<{ next?: string | string[] }> };

export default function LoginPage({ searchParams }: LoginPageProps) {
  return (
    <Suspense fallback={null}>
      <LoginCard searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginCard({ searchParams }: LoginPageProps) {
  if (await getSession()) {
    redirect("/");
  }
  const { next } = await searchParams;

  return (
    <div className="border-divider bg-card w-full max-w-sm space-y-6 rounded-xl border p-8 shadow-sm">
      <div className="space-y-1 text-center">
        <BrandLogo variant="stacked" className="mb-4" />
        <h1 className="text-2xl font-semibold tracking-tight">{messages.auth.login.title}</h1>
        <p className="text-muted-foreground text-sm">{messages.auth.login.description}</p>
      </div>
      <LoginForm next={safeNextPath(Array.isArray(next) ? next[0] : next)} />
    </div>
  );
}
