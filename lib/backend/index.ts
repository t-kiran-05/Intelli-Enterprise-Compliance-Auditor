/**
 * lib/backend/index.ts - Barrel export for the failover backend module.
 */

export { AwsClient } from "./aws-client";
export { ServerClient } from "./server-client";
export {
  getCircuitState,
  recordFailure,
  recordSuccess,
  isFailoverStatus,
} from "./circuit-breaker";
export type { CircuitState } from "./circuit-breaker";
export {
  routerInitUpload,
  routerStartAudit,
  routerGetResult,
  routerHealth,
} from "./router";
export { parseCompositeId } from "./types";
export type {
  AuditResult,
  AuditStartResult,
  BackendClient,
  CompositeId,
  HealthResult,
  UploadResult,
} from "./types";
