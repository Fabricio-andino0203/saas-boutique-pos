export const messages = {
  app: { name: "Boutique POS" },
  nav: { home: "Inicio" },
  common: {
    loading: "Cargando…",
    retry: "Reintentar",
    cancel: "Cancelar",
    confirm: "Confirmar",
    close: "Cerrar",
    skipToContent: "Saltar al contenido",
    toggleSidebar: "Mostrar u ocultar el menú",
  },
  home: {
    title: "Inicio",
    description: "Aquí verás el resumen de tu tienda cuando termines de configurarla.",
  },
  states: {
    notFound: {
      title: "No encontramos esa página",
      description: "Revisa la dirección o vuelve al inicio.",
      action: "Ir al inicio",
    },
    error: {
      title: "Algo salió mal",
      description: "No pudimos mostrar esta pantalla. Puedes intentarlo de nuevo.",
    },
    empty: {
      title: "Aún no hay nada por aquí",
      description: "Cuando agregues información aparecerá en esta lista.",
    },
  },
  errors: {
    VALIDATION: "Revisa los datos ingresados: hay campos incompletos o con formato incorrecto.",
    NOT_FOUND: "No encontramos lo que buscas. Puede que ya no exista.",
    UNAUTHORIZED: "Tu sesión terminó. Vuelve a iniciar sesión para continuar.",
    FORBIDDEN: "No tienes permiso para hacer esto. Pídele ayuda a un gerente.",
    CONFLICT: "Esto cambió mientras lo editabas. Actualiza la pantalla e inténtalo de nuevo.",
    INSUFFICIENT_STOCK:
      "No quedan suficientes prendas de este artículo. ¿Quieres ver otras tallas o colores?",
    CASH_SESSION_CLOSED: "Abre tu caja para empezar a vender.",
    FISCAL_RANGE_EXHAUSTED: "El rango de facturas se agotó o ya venció. Solicita uno nuevo al SAR.",
    UNEXPECTED:
      "Ocurrió un problema inesperado. Inténtalo de nuevo; si sigue pasando, avisa al administrador.",
  },
  dev: {
    gallery: {
      title: "Galería de componentes",
      description: "Solo para desarrollo: cada componente compartido en cada uno de sus estados.",
      money: { label: "Monto" },
      confirm: {
        open: "Abrir confirmación",
        title: "¿Quitar esta prenda?",
        description: "Esta acción no se puede deshacer.",
        confirm: "Quitar",
      },
      table: {
        loading: "Tabla: cargando",
        empty: "Tabla: sin datos",
        error: "Tabla: con error",
        rows: "Tabla: con datos",
        columnProduct: "Producto",
        columnPrice: "Precio",
        emptyAction: "Agregar producto de ejemplo",
        errorMessage: "No pudimos cargar los productos.",
        sampleDress: "Vestido floral",
        sampleBlouse: "Blusa de lino",
      },
    },
  },
} as const;
