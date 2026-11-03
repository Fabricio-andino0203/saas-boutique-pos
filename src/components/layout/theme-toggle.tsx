"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY } from "@/components/layout/theme-script";
import { Button } from "@/components/ui/button";
import { messages } from "@/config/messages.es";

/** La clase `dark` de `<html>` es la única fuente de verdad: el script del `<head>` la pone y este botón la cambia. */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const isDark = () => document.documentElement.classList.contains("dark");

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

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
