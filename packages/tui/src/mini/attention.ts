// Attention sounds and desktop notifications for mini.
//
// The full TUI reaches this behaviour through a plugin; mini has no plugin
// host, so the mapping is inlined. Only the mapping — the machinery underneath
// is core's `createTuiAttention`, which already owns the enable gate, the focus
// gate, sound packs, volume, per-sound overrides, and the OS notification. It
// takes a structurally-typed renderer, so mini's `CliRenderer` satisfies it as
// it stands.
//
// Everything here is therefore one question: which stream events are worth
// interrupting someone for, and with which sound.
import type { TuiAttentionSoundName } from "@opencode-ai/plugin/tui"
import { createTuiAttention } from "../attention"
import type { Config } from "../config"

// The subset of CliRenderer that core's attention host needs. Restated rather
// than imported so this module does not depend on the renderer's full surface.
export type AttentionRenderer = {
  readonly isDestroyed: boolean
  on(event: "focus" | "blur", listener: () => void): unknown
  off(event: "focus" | "blur", listener: () => void): unknown
  triggerNotification(message: string, title?: string): boolean
}

// The shape mini's transport reports. Narrow on purpose: a structural match on
// the few event types that matter, so this never has to track the full union.
export type AttentionEvent = {
  type: string
  data?: unknown
}

type Alert = {
  sound: TuiAttentionSoundName
  message: string
  title?: string
}

export type MiniAttention = {
  handle(event: AttentionEvent, root: boolean): void
  dispose(): void
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

// Failures arrive as `{ error: { message?, _tag? } }` on the execution event.
// The message is whatever the provider said; the tag is the fallback so an
// empty payload still says something more useful than "failed".
function failureMessage(data: unknown): string {
  const error = record(record(data)["error"])
  return text(error["message"]) ?? text(error["_tag"]) ?? "Session failed"
}

/**
 * Picks the alert for an event, or nothing.
 *
 * `root` distinguishes the session being driven from its subagents. Blocking
 * requests are voiced either way — a subagent waiting on a permission stops
 * the turn just as hard — while completion is voiced only for the root, since
 * a subagent finishing is a step inside a turn that will announce itself when
 * it ends.
 *
 * User interruption is deliberately silent: the user just did it.
 */
export function alertFor(event: AttentionEvent, root: boolean): Alert | undefined {
  if (event.type === "permission.v2.asked") {
    return { sound: "permission", message: "Permission needs input" }
  }

  if (event.type === "form.created") {
    const form = record(record(event.data)["form"])
    return { sound: "question", message: "Input needs response", title: text(form["title"]) }
  }

  if (!root) {
    return undefined
  }

  if (event.type === "session.execution.succeeded") {
    return { sound: "done", message: "Session done" }
  }

  if (event.type === "session.execution.failed") {
    return { sound: "error", message: failureMessage(event.data) }
  }

  return undefined
}

export function createMiniAttention(input: {
  renderer: AttentionRenderer
  config: Pick<Config.Resolved, "attention">
}): MiniAttention {
  const attention = createTuiAttention({ renderer: input.renderer, config: input.config })

  return {
    handle(event, root) {
      const alert = alertFor(event, root)
      if (!alert) {
        return
      }

      // `when: "blurred"` hands the focus gate to core, which also suppresses
      // on unknown focus — the right default for terminals and multiplexers
      // that never report focus at all, where every alert would otherwise fire
      // while the user is looking straight at it.
      void attention
        .notify({
          title: alert.title,
          message: alert.message,
          notification: { when: "blurred" },
          sound: { name: alert.sound, when: "blurred" },
        })
        .catch(() => {})
    },
    dispose() {
      attention.dispose()
    },
  }
}
