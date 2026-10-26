/** Lee un campo de texto de un formulario; si falta o no es texto, devuelve cadena vacía. */
export function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
