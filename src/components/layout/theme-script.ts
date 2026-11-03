/** Clave con la que cada navegador recuerda la elección de tema (`light` o `dark`). Sin elección, manda el sistema. */
export const THEME_STORAGE_KEY = "theme";

/**
 * Se ejecuta en `<head>` antes de que el navegador pinte, para que la página nazca ya en el tema correcto y no parpadee.
 * Cualquier fallo (almacenamiento bloqueado, modo privado) deja el tema claro, que es el valor de fábrica.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;
