-- La contraseña que otra persona le puso a esta cuenta (el alta del propietario, una restauración por soporte o por un gerente)
-- es temporal: al entrar hay que cambiarla antes de hacer cualquier otra cosa. Aditiva y con valor de fábrica: la versión
-- anterior de la aplicación no la usa y sigue funcionando con la columna presente.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
