import { useSyncExternalStore } from "react";

/** La clase `dark` de `<html>` es la única fuente de verdad del tema: el script del `<head>` la pone y el botón la cambia. */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const isDark = () => document.documentElement.classList.contains("dark");

/** `true` cuando la pantalla está en modo oscuro; en el servidor y al hidratar vale `false` y se corrige sin parpadeo. */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, isDark, () => false);
}
