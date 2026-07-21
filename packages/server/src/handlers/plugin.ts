import { Plugin } from "@opencode-ai/core/plugin"
import { PluginRpc } from "@opencode-ai/core/plugin/rpc"
import { PluginRpcError, PluginRpcMethodNotFoundError } from "@opencode-ai/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const PluginHandler = HttpApiBuilder.group(Api, "server.plugin", (handlers) =>
  handlers
    .handle("plugin.list", () =>
      Effect.gen(function* () {
        return yield* response(Plugin.Service.use((plugin) => plugin.list()))
      }),
    )
    .handle("plugin.rpc", (ctx) =>
      Effect.gen(function* () {
        const rpc = yield* PluginRpc.Service
        return yield* response(
          rpc.call(ctx.params.method, ctx.payload.payload).pipe(
            Effect.catch((error) =>
              Effect.fail(
                error instanceof PluginRpc.MethodNotFoundError
                  ? new PluginRpcMethodNotFoundError({
                      method: ctx.params.method,
                      message: `Plugin RPC method not found: ${ctx.params.method}`,
                    })
                  : new PluginRpcError({
                      method: ctx.params.method,
                      message: error instanceof Error ? error.message : String(error),
                    }),
              ),
            ),
          ),
        )
      }),
    ),
)
