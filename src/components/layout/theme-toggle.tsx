"use client";

import { Moon, Sun } from "lucide-react";

import { THEME_STORAGE_KEY } from "@/components/layout/theme-script";
import { useIsDark } from "@/components/layout/use-theme";
import { Button } from "@/components/ui/button";
import { messages } from "@/config/messages.es";

export function ThemeToggle() {
  const dark = useIsDark();

  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Sin almacenamiento el cambio vale para esta pantalla y la siguiente visita vuelve a seguir al sistema.
    }
  }

  const label = dark ? messages.theme.toLight : messages.theme.toDark;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}
