"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import type { SettingsSnapshot } from "@/lib/settings";
import { finishOnboardingAction } from "@/modules/settings/actions";
import type { BusinessValues } from "@/modules/settings/service";
import { cn } from "@/lib/utils";

import { BusinessForm, SettingsForm } from "./settings-forms";
import { SampleDataButton } from "./sample-data-button";

const copy = messages.settings.onboarding;

type OnboardingWizardProps = {
  business: BusinessValues;
  settings: SettingsSnapshot;
  sampleLoaded: boolean;
};

export function OnboardingWizard({ business, settings, sampleLoaded }: OnboardingWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const last = copy.steps.length - 1;
  const next = () => setStep((current) => Math.min(current + 1, last));

  function finish() {
    startTransition(async () => {
      await finishOnboardingAction();
      router.push("/");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label={copy.title}>
        {copy.steps.map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? "step" : undefined}
            className={cn(
              "rounded-full border px-3 py-1",
              index === step
                ? "border-primary bg-primary text-primary-foreground"
                : index < step
                  ? "border-primary text-primary"
                  : "text-muted-foreground",
            )}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <section className="space-y-4" aria-labelledby="step-business">
          <h2 id="step-business" className="text-lg font-medium">
            {messages.settings.business.title}
          </h2>
          <p className="text-muted-foreground text-sm">{messages.settings.business.description}</p>
          <BusinessForm values={business} onSaved={next} submitLabel={copy.next} />
        </section>
      ) : null}

      {step === 1 ? (
        <section className="space-y-4" aria-labelledby="step-tax">
          <h2 id="step-tax" className="sr-only">
            {copy.steps[1]}
          </h2>
          <SettingsForm
            groups={["tax", "payments"]}
            values={settings}
            onSaved={next}
            submitLabel={copy.next}
          />
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-4" aria-labelledby="step-rules">
          <h2 id="step-rules" className="sr-only">
            {copy.steps[2]}
          </h2>
          <SettingsForm
            groups={["rules"]}
            values={settings}
            onSaved={next}
            submitLabel={copy.next}
          />
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-4" aria-labelledby="step-goods">
          <h2 id="step-goods" className="text-lg font-medium">
            {copy.goalTitle}
          </h2>
          <p className="text-muted-foreground text-sm">{copy.goalText}</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/productos/nuevo" className={buttonVariants({ variant: "outline" })}>
              {copy.createLink}
            </Link>
            <Link href="/productos/importar" className={buttonVariants({ variant: "outline" })}>
              {copy.importLink}
            </Link>
          </div>
          <p className="text-muted-foreground text-sm">{copy.sampleText}</p>
          <SampleDataButton alreadyLoaded={sampleLoaded} />
          <Button type="button" onClick={next}>
            {copy.next}
          </Button>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="space-y-4" aria-labelledby="step-done">
          <h2 id="step-done" className="text-lg font-medium">
            {copy.doneTitle}
          </h2>
          <p className="text-muted-foreground text-sm">{copy.doneText}</p>
          <Button type="button" disabled={pending} onClick={finish}>
            {copy.goHome}
          </Button>
        </section>
      ) : null}

      {step > 0 && step < last ? (
        <Button type="button" variant="ghost" onClick={() => setStep((current) => current - 1)}>
          {copy.previous}
        </Button>
      ) : null}
    </div>
  );
}
