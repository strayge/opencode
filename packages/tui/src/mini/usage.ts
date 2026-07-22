// Provider subscription usage: wire format and display logic.
//
// Ported from the provider-usage plugin, which mini cannot load. The server
// half of that plugin is untouched and still does all the work — it holds the
// credentials, calls the provider endpoints, and caches. This is only the
// shape of what comes back over plugin RPC and how it reads on screen.
//
// Deliberately free of opencode and opentui imports so the validation and
// formatting can be exercised without a renderer or a server.

/** Which quota window a value belongs to. */
export type WindowCategory = "5h" | "7d" | "30d"

export type UsageWindow = {
  category: WindowCategory
  /** Short display label, e.g. "5h", "7d", or "30d". */
  label: string
  /** 0-100 percent of the window used. */
  percent: number
  /** Epoch ms when the window resets. */
  resetsAt: number
}

/** Providers the server plugin has a usage adapter for. */
export const ADAPTER_IDS = ["openai", "opencode-go"] as const
export type ProviderId = (typeof ADAPTER_IDS)[number]

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "oai",
  "opencode-go": "go",
}

// Preferred window when nothing is exhausted. Go's monthly window is the one
// that actually binds on that plan; the others fall through to the 5h/weekly
// order below.
export const PREFERRED_WINDOW: Partial<Record<ProviderId, WindowCategory>> = {
  "opencode-go": "30d",
}

export type UsageRpcResult =
  | {
      ok: true
      provider: ProviderId
      windows: UsageWindow[]
      fetchedAt: number
      /**
       * Consumable tokens that reset an exhausted window early. Provider-level
       * rather than per-window, and omitted when zero — most accounts hold none.
       */
      resetCredits?: number
    }
  | {
      ok: false
      provider?: ProviderId
      /**
       * `no_connection` — not connected in opencode; hidden entirely.
       * `not_configured` — connected, but the server plugin still needs config
       * (Go's cookie/workspace); surfaced so misconfiguration is distinguishable
       * from an absent provider.
       */
      reason:
        | "invalid_request"
        | "no_connection"
        | "not_configured"
        | "not_oauth"
        | "expired"
        | "resolve_failed"
        | "fetch_failed"
    }

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (ADAPTER_IDS as readonly string[]).includes(value)
}

function isCategory(value: unknown): value is WindowCategory {
  return value === "5h" || value === "7d" || value === "30d"
}

/**
 * Chooses which windows to show for one provider.
 *
 * An exhausted window (>=100%) always wins — a blocked limit is the thing worth
 * surfacing, not one that still has headroom. Otherwise the provider's
 * preferred window, then the 5h session window, then the weekly one, then
 * whatever is first.
 */
export function selectWindows(all: UsageWindow[], preferred?: WindowCategory): UsageWindow[] {
  const exhausted = all.filter((window) => window.percent >= 100)
  if (exhausted.length > 0) return exhausted
  if (preferred) {
    const pick = all.find((window) => window.category === preferred)
    if (pick) return [pick]
  }
  const five = all.find((window) => window.category === "5h")
  if (five) return [five]
  const weekly = all.find((window) => window.category === "7d")
  if (weekly) return [weekly]
  return all.length > 0 ? [all[0]!] : []
}

function isUsageWindow(value: unknown): value is UsageWindow {
  if (!value || typeof value !== "object") return false
  const window = value as Record<string, unknown>
  return (
    isCategory(window["category"]) &&
    typeof window["label"] === "string" &&
    typeof window["percent"] === "number" &&
    Number.isFinite(window["percent"]) &&
    typeof window["resetsAt"] === "number" &&
    Number.isFinite(window["resetsAt"])
  )
}

/** Rejects malformed or non-JSON RPC responses before they reach the footer. */
export function parseUsageRpcResult(value: unknown): UsageRpcResult | null {
  if (!value || typeof value !== "object") return null
  const result = value as Record<string, unknown>
  if (result["ok"] === true) {
    if (!isProviderId(result["provider"])) return null
    if (!Array.isArray(result["windows"]) || !result["windows"].every(isUsageWindow)) return null
    if (typeof result["fetchedAt"] !== "number" || !Number.isFinite(result["fetchedAt"])) return null
    const credits = result["resetCredits"]
    return {
      ok: true,
      provider: result["provider"],
      windows: result["windows"] as UsageWindow[],
      fetchedAt: result["fetchedAt"],
      ...(typeof credits === "number" && Number.isFinite(credits) ? { resetCredits: credits } : {}),
    }
  }
  if (result["ok"] !== false) return null
  const reason = result["reason"]
  if (
    reason !== "invalid_request" &&
    reason !== "no_connection" &&
    reason !== "not_configured" &&
    reason !== "not_oauth" &&
    reason !== "expired" &&
    reason !== "resolve_failed" &&
    reason !== "fetch_failed"
  )
    return null
  const provider = result["provider"]
  if (provider !== undefined && !isProviderId(provider)) return null
  return { ok: false, provider, reason }
}

/**
 * Compact countdown. Precision drops as the horizon grows so distant resets
 * stay short: beyond 36h only days ("6d"), beyond 6h no minutes ("7h",
 * "1d 6h"), and within 6h the full "1h 22m" / "11m".
 */
export function formatDurationShort(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60_000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (totalMinutes > 36 * 60) return `${days}d`
  if (totalMinutes > 6 * 60) {
    if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
    return `${hours}h`
  }
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}

/** Limit label for `/usage`: weekly reads "week", monthly "month", else its own label. */
export function limitLabel(window: UsageWindow): string {
  if (window.category === "7d") return "week"
  if (window.category === "30d") return "month"
  return window.label
}

export function percentOf(window: UsageWindow): number {
  return Math.min(100, Math.max(0, Math.round(window.percent)))
}

/** Text for a non-ok result. `undefined` means the RPC never answered at all. */
export function errorText(result: UsageRpcResult | undefined): string {
  if (!result) return "usage service unavailable"
  if (result.ok) return ""
  if (result.reason === "not_configured") return "missing config"
  if (result.reason === "expired") return "credential expired"
  if (result.reason === "resolve_failed") return "credential refresh failed"
  if (result.reason === "fetch_failed") return "usage request failed"
  return "unavailable"
}

/**
 * Whether a provider belongs in `/usage` at all. Providers with no opencode
 * connection are hidden, so the listing mirrors what opencode is actually set
 * up for. A missing RPC answer is a transient service state rather than an
 * absent provider, so it still shows.
 */
export function isConfigured(result: UsageRpcResult | undefined): boolean {
  if (!result) return true
  if (result.ok) return true
  return result.reason !== "no_connection" && result.reason !== "not_oauth"
}

export type ProviderResult = { id: ProviderId; result: UsageRpcResult | undefined }

/**
 * The `/usage` report: one line per provider listing every window it reports,
 * regardless of which one the compact segment picked.
 *
 * A line per provider rather than the plugin's single row, because this lands
 * in scrollback where vertical space is free and horizontal space is not.
 */
export function formatUsageReport(results: ProviderResult[], now: number): string {
  const shown = results.filter((entry) => isConfigured(entry.result))
  if (shown.length === 0) return "usage: no providers configured in opencode"

  const width = Math.max(...shown.map((entry) => PROVIDER_LABELS[entry.id].length))
  const lines = shown.map((entry) => {
    const name = PROVIDER_LABELS[entry.id].padEnd(width)
    const result = entry.result
    if (!result?.ok || result.windows.length === 0) return `  ${name}  ${errorText(result) || "no windows"}`

    const parts = result.windows.map(
      (window) => `${limitLabel(window)}: ${percentOf(window)}% ${formatDurationShort(window.resetsAt - now)}`,
    )
    // Reset credits are provider-level, and zero is the common case, so they
    // ride at the end only when the account actually holds any.
    const credits = result.resetCredits ?? 0
    if (credits > 0) parts.push(`${credits} ${credits === 1 ? "reset" : "resets"}`)
    return `  ${name}  ${parts.join(" · ")}`
  })

  return ["usage", ...lines].join("\n")
}
