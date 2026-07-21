export * as PluginRpc from "./rpc"

import { Context, Effect, Layer, Schema, Scope } from "effect"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"

/**
 * Flat method registry that lets server plugins expose request handlers to
 * clients (TUI plugins, SDK consumers) through one generic protocol endpoint.
 * Methods share one namespace per Location, so plugins should prefix method
 * names with their plugin ID. Registrations are scoped: unloading the owning
 * plugin removes its handlers.
 */

export class MethodNotFoundError extends Schema.TaggedErrorClass<MethodNotFoundError>()(
  "PluginRpc.MethodNotFoundError",
  {
    method: Schema.String,
  },
) {}

export type Handler = (payload: unknown) => Effect.Effect<unknown, unknown>

export interface Registration {
  readonly dispose: Effect.Effect<void>
}

export interface Interface {
  readonly register: (method: string, handler: Handler) => Effect.Effect<Registration, never, Scope.Scope>
  readonly call: (method: string, payload: unknown) => Effect.Effect<unknown, unknown>
  readonly list: () => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/PluginRpc") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const handlers = new Map<string, Handler>()

    return Service.of({
      register: (method, handler) =>
        Effect.acquireRelease(
          Effect.suspend(() => {
            const name = method.trim()
            if (!name) return Effect.die(new Error("Plugin RPC method name must not be empty"))
            if (handlers.has(name)) return Effect.die(new Error(`Plugin RPC method already registered: ${name}`))
            handlers.set(name, handler)
            const dispose = Effect.sync(() => {
              if (handlers.get(name) === handler) handlers.delete(name)
            })
            return Effect.succeed({ dispose })
          }),
          (registration) => registration.dispose,
        ),
      call: (method, payload) =>
        Effect.suspend(() => {
          const handler = handlers.get(method)
          if (!handler) return Effect.fail(new MethodNotFoundError({ method }))
          return handler(payload)
        }),
      list: () => Effect.sync(() => Array.from(handlers.keys())),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [],
})
