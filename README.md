# Boutique POS — Desarrollo local

## Requisitos

- Node 24, pnpm 12.15, Docker con `docker compose` (el motor en marcha) y git.
- Identidad de git configurada (`git config user.name` y `git config user.email`).

## Primer arranque

```bash
git clone <url-del-repositorio> boutique-pos
cd boutique-pos
cp .env.example .env
pnpm install
pnpm db:generate
pnpm db:up
pnpm db:deploy
pnpm db:seed
pnpm dev
```

`pnpm db:generate` es obligatorio: `src/generated` no se versiona y Prisma 7 no genera el cliente al migrar. Después abre <http://localhost:3000>.

Si otra pila Docker usa el puerto 5432 (Postgres), detenla antes de `pnpm db:up`.

## Usuarios de demostración (solo desarrollo)

Los crea `pnpm db:seed`. Cámbialos antes de llevar el sistema a producción.

| Usuario | Rol | Contraseña | PIN |
|---|---|---|---|
| `owner` | Propietario | `Demo-Propietario-2026` | `1111` |
| `manager` | Gerente | `Demo-Gerente-2026` | `2222` |
| `cashier` | Cajero | `Demo-Cajero-2026` | `3333` |
| `warehouse` | Almacén | `Demo-Almacen-2026` | `4444` |

## Pruebas

```bash
pnpm test                                 # unitarias e integración (necesita la BD arriba)
pnpm exec playwright install chromium     # una sola vez
pnpm test:e2e                             # compila la app y recorre la interfaz
```

En un clon limpio, `pnpm exec next typegen` va antes de `pnpm typecheck` (genera los tipos de rutas de Next, que no se versionan).

---

# Paquete de contexto — Boutique POS

Este paquete contiene todo el contexto y el plan para que **Claude Code** construya el sistema de inventario y punto de venta de la boutique. **No contiene código**: es la especificación.

## Contenido

```
boutique-pos-docs/
├── README.md                  ← este archivo
├── CLAUDE.md                  ← contexto maestro (Claude Code lo lee solo)
└── docs/
    ├── PRD.md                 ← qué construir
    ├── DATA_MODEL.md          ← modelo de datos
    ├── ARCHITECTURE.md        ← cómo construirlo
    ├── UX.md                  ← cómo debe verse y sentirse
    ├── ROADMAP.md             ← fases + prompts listos para pegar
    └── DECISIONS_PENDING.md   ← preguntas abiertas (revísalas primero)
```

## Cómo usarlo

1. Crea la carpeta de tu proyecto y copia dentro todo el contenido (`CLAUDE.md` en la raíz, `docs/` al lado).
2. **Antes de empezar, revisa `docs/DECISIONS_PENDING.md`.** Cada pregunta ya trae un valor por defecto; cambia los que no apliquen a tu negocio. Lo más importante: temas fiscales (CAI/ISV), si habrá lector de código de barras e impresora térmica, y si manejas apartados.
3. Abre Claude Code en la carpeta del proyecto (`claude`).
4. Pega el **prompt de la Fase 0** que está en `docs/ROADMAP.md`.
5. Avanza fase por fase. No saltes fases: cada una depende de la anterior.
6. Al terminar cada fase, haz commit y pide a Claude Code que actualice la lista de estado en `CLAUDE.md`.

## Consejos para trabajar con Claude Code

- Usa **plan mode** al inicio de cada fase y aprueba el plan antes de que escriba código.
- Pide **incrementos verticales pequeños** (una pantalla completa funcionando) en vez de "toda la fase de golpe".
- Si Claude Code propone algo que contradice una regla de `CLAUDE.md` sección 6, es una señal de alerta: pídele que lo justifique o lo corrija.
- Cuando cambie una decisión del negocio, **actualiza primero los docs** y luego el código.
