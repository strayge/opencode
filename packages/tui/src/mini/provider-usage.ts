// Polls subscription usage for the mini statusline.
//
// All the work happens server-side: the provider-usage server plugin holds the
// credentials, calls the provider endpoints, and caches successes for two
// minutes with a six-minute backoff after failures. Mini only asks, over the
// fork's plugin RPC endpoint, and never sees a token.
//
// The cadence exists to be polite to endpoints that throttle aggressive
// polling, so the gates below matter as much as the request itself.
import type { OpenCodeClient } from "@opencode-ai/client/promise"
import {
  ADAPTER_IDS,
  parseUsageRpcResult,
  type ProviderId,
  type ProviderResult,
  type UsageRpcResult,
  type UsageWindow,
} from "./usage"

const RPC_METHOD = "provider-usage.fetch"
const POLL_MS = 120_000
// Cold-start retry, doubling to the cap. The server plugin registers its
// handler shortly after mini starts, so the first poll can find no handler at
// all; waiting out POLL_MS would leave the segment blank for two minutes.
const RETRY_MS = 2_000
const RETRY_MAX_MS = 30_000
// Stop polling after this long without the user present. Values stay on screen
// but read as stale.
const IDLE_MS = 300_000

export type UsageSnapshot = {
  windows: Partial<Record<ProviderId, UsageWindow[]>>
  stale: boolean
}

export type ProviderUsage = {
  /** Marks the user present; resumes the cadence if it had gone stale. */
  activity(): void
  /** Bypasses the server cache and returns every provider's full answer. */
  refresh(): Promise<ProviderResult[]>
  close(): void
}

export type ProviderUsageInput = {
  sdk: () => OpenCodeClient
  /** Terminal focus. Polling pauses while blurred. */
  focused: () => "unknown" | "focused" | "blurred"
  onChange: (snapshot: UsageSnapshot) => void
  /** Suppresses polling entirely, e.g. while the footer is hidden. */
  enabled?: () => boolean
  now?: () => number
}

export function createProviderUsage(input: ProviderUsageInput): ProviderUsage {
  const now = input.now ?? (() => Date.now())
  const windows: Partial<Record<ProviderId, UsageWindow[]>> = {}
  let stale = false
  let disposed = false
  let lastActive = now()
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryDelay = RETRY_MS

  const emit = () => {
    if (disposed) return
    input.onChange({ windows: { ...windows }, stale })
  }

  const setStale = (next: boolean) => {
    if (stale === next) return
    stale = next
    emit()
  }

  const poll = async (provider: ProviderId, force = false): Promise<UsageRpcResult | undefined> => {
    try {
      const response = await input.sdk().plugin.rpc({ method: RPC_METHOD, payload: { provider, force } })
      const result = parseUsageRpcResult(response.data)
      if (!result || result.provider !== provider) return undefined
      if (result.ok) {
        windows[provider] = result.windows
        emit()
        return result
      }
      // A provider that went away should stop showing a stale reading; a
      // transient fetch failure keeps the last good one on screen.
      if (result.reason === "no_connection" || result.reason === "not_oauth" || result.reason === "expired") {
        delete windows[provider]
        emit()
      }
      return result
    } catch {
      // The server plugin may still be loading. The retry below covers it.
      return undefined
    }
  }

  const scheduleRetry = () => {
    if (disposed || retryTimer) return
    const delay = retryDelay
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS)
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      void pollAll()
    }, delay)
  }

  const clearRetry = () => {
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = undefined
    retryDelay = RETRY_MS
  }

  const pollAll = async () => {
    if (disposed) return
    // Both signals of absence: the terminal is blurred, or nothing has happened
    // for IDLE_MS. Either way stop hitting the network and dim what is there.
    if (input.enabled?.() === false || input.focused() === "blurred" || now() - lastActive >= IDLE_MS) {
      setStale(true)
      return
    }

    setStale(false)
    const results = await Promise.all(ADAPTER_IDS.map((id) => poll(id)))
    if (results.some((result) => result === undefined)) scheduleRetry()
    else clearRetry()
  }

  void pollAll()
  pollTimer = setInterval(() => void pollAll(), POLL_MS)

  return {
    activity() {
      // Events arriving while blurred are the agent working, not the user
      // present, so they must not revive the cadence.
      if (disposed || input.focused() === "blurred") return
      lastActive = now()
      if (stale) {
        setStale(false)
        void pollAll()
      }
    },
    async refresh() {
      // An explicit /usage is itself presence: resume the cadence and un-dim.
      lastActive = now()
      setStale(false)
      const results = await Promise.all(
        ADAPTER_IDS.map(async (id) => ({ id, result: await poll(id, true) }) satisfies ProviderResult),
      )
      if (results.some((entry) => entry.result === undefined)) scheduleRetry()
      else clearRetry()
      return results
    },
    close() {
      disposed = true
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = undefined
      clearRetry()
    },
  }
}
