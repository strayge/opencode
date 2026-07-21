import { Location } from "@opencode-ai/schema/location"
import { Plugin } from "@opencode-ai/schema/plugin"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { PluginRpcError, PluginRpcMethodNotFoundError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const PluginGroup = HttpApiGroup.make("server.plugin")
  .add(
    HttpApiEndpoint.get("plugin.list", "/api/plugin", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Plugin.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.plugin.list",
          summary: "List plugins",
          description: "Retrieve currently loaded plugins.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("plugin.rpc", "/api/plugin/rpc/:method", {
      params: { method: Schema.String },
      query: LocationQuery,
      payload: Schema.Struct({
        payload: Schema.optional(Schema.Unknown),
      }),
      success: Location.response(Schema.Unknown),
      error: [PluginRpcMethodNotFoundError, PluginRpcError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.plugin.rpc",
          summary: "Call plugin method",
          description:
            "Invoke a request handler registered by a server plugin. Methods share one flat namespace per location; payload and result are plugin-defined JSON.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "plugin",
      description: "Experimental plugin routes.",
    }),
  )
