// La comprobación vive en la capa de tenancy porque `/api/health` (código de la aplicación, no del panel) también la usa.
export { checkPlatformHealth } from "@/lib/tenancy/platform-health";
