import qrcode from "qrcode-generator";

/**
 * Dibuja un código QR en el servidor (SVG, sin enviar nada a terceros: el contenido lleva el secreto del 2FA). El SVG lo
 * produce la biblioteca a partir de los datos, no de texto escrito por una persona.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  return (
    <div
      role="img"
      aria-label={label}
      className="size-52 rounded-lg bg-white p-2 [&>svg]:size-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
