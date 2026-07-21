import type { Effect, Scope } from "effect"

export interface RpcRegistration {
  readonly dispose: Effect.Effect<void>
}

/**
 * Server-plugin request handlers reachable by any OpenCode client through
 * `POST /api/plugin/rpc/:method`. Methods share one flat namespace per
 * Location; prefix method names with the plugin ID (for example
 * "provider-usage.list"). Registrations dispose with the plugin scope.
 */
export interface RpcDomain {
  readonly register: (
    method: string,
    handler: (payload: unknown) => Effect.Effect<unknown, unknown>,
  ) => Effect.Effect<RpcRegistration, never, Scope.Scope>
  readonly call: (method: string, payload?: unknown) => Effect.Effect<unknown, unknown>
}
