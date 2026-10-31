import type { Instrumentation } from "next";

/** Se ejecuta una vez cuando arranca el servidor. Todo el trabajo está en `instrumentation-node.ts`. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    registerNode();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { onRequestErrorNode } = await import("./instrumentation-node");
    await onRequestErrorNode(error, request, context);
  }
};
