"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";

import { FormField } from "@/components/shared/form-field";
import { Notice } from "@/components/shared/notice";
import { Button } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { removeLogoAction, saveLogoAction } from "@/modules/settings/actions";
import type { SettingsActionState } from "@/modules/settings/schemas";

const copy = messages.settings.logo;

/** El logo que sale arriba del ticket: se sube una vez, se ve como quedará (en grises) y se puede quitar. */
export function LogoForm({ logo }: { logo: string | null }) {
  const router = useRouter();
  const [removed, setRemoved] = useState<SettingsActionState>(undefined);
  const [removing, startRemoving] = useTransition();
  const [state, formAction, pending] = useActionState(
    async (previous: SettingsActionState, formData: FormData) => {
      // Lo último que se hizo es lo que se cuenta: un «Logo quitado» viejo no tapa el resultado de esta subida.
      setRemoved(undefined);
      const result = await saveLogoAction(previous, formData);
      if (result?.success) {
        router.refresh();
      }
      return result;
    },
    undefined,
  );

  function remove() {
    setRemoved(undefined);
    startRemoving(async () => {
      const result = await removeLogoAction();
      setRemoved(result);
      if (result?.success) {
        router.refresh();
      }
    });
  }

  const feedback = pending || removing ? undefined : (removed ?? state);

  return (
    <form action={formAction} className="space-y-4">
      {logo ? (
        // Un `data:` URI ya reducido por el servidor: no hay nada que optimizar con next/image.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt={messages.settings.logo.alt}
          className="max-h-24 max-w-full rounded-lg border bg-white p-2"
        />
      ) : (
        <p className="text-muted-foreground text-sm">{copy.empty}</p>
      )}
      <FormField label={copy.file} htmlFor="logo">
        <input
          id="logo"
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="file:bg-secondary file:text-secondary-foreground block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
      </FormField>
      {feedback?.error ? <Notice tone="error">{feedback.error}</Notice> : null}
      {feedback?.success ? <Notice tone="success">{feedback.success}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending}>
          {pending ? copy.uploading : logo ? copy.change : copy.upload}
        </Button>
        {logo ? (
          <Button type="button" variant="outline" loading={removing} onClick={remove}>
            {copy.remove}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
