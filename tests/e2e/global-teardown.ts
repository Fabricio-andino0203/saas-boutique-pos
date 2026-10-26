import { deleteE2eData } from "./helpers/cleanup";

/**
 * Se ejecuta una sola vez, cuando terminan todas las pruebas: así una prueba que termina antes no
 * borra los datos de otra que sigue corriendo en paralelo.
 */
export default function globalTeardown(): void {
  deleteE2eData();
}
