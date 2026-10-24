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
