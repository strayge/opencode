import type { Registration } from "./registration.js"

/**
 * Server-plugin request handlers reachable by any OpenCode client through
 * `POST /api/plugin/rpc/:method`. Methods share one flat namespace per
 * Location; prefix method names with the plugin ID (for example
 * "provider-usage.list"). Registrations dispose with the plugin scope.
 */
export interface RpcDomain {
  register(method: string, handler: (payload: unknown) => Promise<unknown> | unknown): Promise<Registration>
  call(method: string, payload?: unknown): Promise<unknown>
}
