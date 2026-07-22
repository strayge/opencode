/** @jsxImportSource @opentui/solid */
// Prompt-cache staleness for the mini statusline.
//
// Providers hold a prompt cache for roughly an hour after a request. While it
// is warm the next turn re-reads the conversation cheaply; once it lapses the
// same context is billed as fresh input. Nothing reports the real lifetime, so
// this assumes the documented hour from the last turn's request and colors the
// context reading once it has passed. The number itself does not change --
// only what it costs to send again.
//
// The clock restarts on every assistant response, so this is per-turn, not
// per-session: it answers "have I been away long enough for the next prompt to
// be expensive", which is exactly the question a long-lived session raises.
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { RunFooterTheme } from "./theme"

export const CACHE_MAX_AGE_MS = 60 * 60 * 1000

export function cacheExpired(updatedAt: number | undefined, now: number): boolean {
  return typeof updatedAt === "number" && now - updatedAt >= CACHE_MAX_AGE_MS
}

// Milliseconds until the cache is assumed dead, or undefined when there is
// nothing to wait for. Zero means it already lapsed.
export function cacheExpiryDelay(updatedAt: number | undefined, now: number): number | undefined {
  if (typeof updatedAt !== "number") {
    return undefined
  }

  return Math.max(0, updatedAt + CACHE_MAX_AGE_MS - now)
}

// Splits the statusline usage reading into its context and cost halves, so
// only the context half carries expiry coloring -- a past turn's cost is a
// fact, and does not go stale.
//
// The separator is the one the transport joins with. If upstream changes it
// this degrades to treating the whole reading as context, which over-colors
// rather than breaking.
export function splitUsage(usage: string): { context: string; cost?: string } {
  const index = usage.indexOf(" · ")
  if (index < 0) {
    return { context: usage }
  }

  return { context: usage.slice(0, index), cost: usage.slice(index + 3) }
}

export function ContextUsage(props: {
  usage: () => string
  usageAt: () => number | undefined
  theme: () => RunFooterTheme
  mono?: boolean
}) {
  const [expired, setExpired] = createSignal(false)
  const parts = createMemo(() => splitUsage(props.usage()))

  // Re-armed on every turn, so the colour flips at the moment the hour lapses
  // rather than waiting for the next event to repaint the footer.
  createEffect(() => {
    const now = Date.now()
    const updatedAt = props.usageAt()
    setExpired(cacheExpired(updatedAt, now))

    const delay = cacheExpiryDelay(updatedAt, now)
    if (!delay) {
      return
    }

    const timer = setTimeout(() => setExpired(true), delay)
    onCleanup(() => clearTimeout(timer))
  })

  // Mono has no error colour to spend -- every slot in that palette is the
  // foreground -- so staleness has to be a character there.
  const context = createMemo(() => (expired() && props.mono ? `${parts().context}!` : parts().context))

  return (
    <>
      <Show when={parts().context.length > 0}>
        <span style={{ fg: expired() ? props.theme().error : props.theme().muted }}>{context()}</span>
      </Show>
      <Show when={parts().context.length > 0 && parts().cost}>
        <span style={{ fg: props.theme().muted }}>{props.mono ? " - " : " · "}</span>
      </Show>
      <Show when={parts().cost}>
        {(cost) => <span style={{ fg: props.theme().muted }}>{cost()}</span>}
      </Show>
    </>
  )
}
