import { expect, test } from "bun:test"
import type { OpenCodeClient } from "@opencode-ai/client/promise"
import { createProviderUsage, type UsageSnapshot } from "../../src/mini/provider-usage"
import { usageGroups } from "../../src/mini/provider-usage.view"
import {
  formatDurationShort,
  formatUsageReport,
  isConfigured,
  parseUsageRpcResult,
  selectWindows,
  type ProviderResult,
  type UsageWindow,
} from "../../src/mini/usage"

const HOUR = 3_600_000
const NOW = 1_700_000_000_000

function window(category: UsageWindow["category"], percent: number, resetsInMs: number): UsageWindow {
  return { category, label: category, percent, resetsAt: NOW + resetsInMs }
}

test("an exhausted window always wins the compact slot", () => {
  const all = [window("5h", 12, HOUR), window("7d", 100, 48 * HOUR)]

  // Not the 5h session window, which still has room.
  expect(selectWindows(all).map((item) => item.category)).toEqual(["7d"])
  // Even against an explicit preference.
  expect(selectWindows(all, "5h").map((item) => item.category)).toEqual(["7d"])
})

test("with nothing exhausted the preferred window is picked, then 5h, then weekly", () => {
  const all = [window("5h", 12, HOUR), window("7d", 30, 48 * HOUR), window("30d", 22, 500 * HOUR)]

  expect(selectWindows(all, "30d").map((item) => item.category)).toEqual(["30d"])
  expect(selectWindows(all).map((item) => item.category)).toEqual(["5h"])
  expect(selectWindows([window("7d", 30, HOUR)]).map((item) => item.category)).toEqual(["7d"])
  expect(selectWindows([])).toEqual([])
})

test("countdowns shed precision as the horizon grows", () => {
  expect(formatDurationShort(11 * 60_000)).toBe("11m")
  expect(formatDurationShort(HOUR + 22 * 60_000)).toBe("1h 22m")
  expect(formatDurationShort(7 * HOUR)).toBe("7h")
  expect(formatDurationShort(30 * HOUR)).toBe("1d 6h")
  expect(formatDurationShort(6 * 24 * HOUR)).toBe("6d")
  expect(formatDurationShort(-1)).toBe("0m")
})

test("malformed RPC answers are rejected rather than half-read", () => {
  expect(parseUsageRpcResult(null)).toBeNull()
  expect(parseUsageRpcResult({ ok: true })).toBeNull()
  expect(parseUsageRpcResult({ ok: true, provider: "nope", windows: [], fetchedAt: 1 })).toBeNull()
  expect(parseUsageRpcResult({ ok: true, provider: "openai", windows: [{}], fetchedAt: 1 })).toBeNull()
  expect(parseUsageRpcResult({ ok: false, reason: "made_up" })).toBeNull()
  expect(parseUsageRpcResult({ ok: false, reason: "no_connection" })).toEqual({
    ok: false,
    provider: undefined,
    reason: "no_connection",
  })
})

test("providers with no opencode connection are hidden, transient failures are not", () => {
  expect(isConfigured(undefined)).toBe(true)
  expect(isConfigured({ ok: false, reason: "no_connection" })).toBe(false)
  expect(isConfigured({ ok: false, reason: "not_oauth" })).toBe(false)
  expect(isConfigured({ ok: false, reason: "not_configured" })).toBe(true)
  expect(isConfigured({ ok: false, reason: "fetch_failed" })).toBe(true)
})

test("the /usage report lists every window, one line per provider", () => {
  const results: ProviderResult[] = [
    {
      id: "openai",
      result: {
        ok: true,
        provider: "openai",
        windows: [window("5h", 12, HOUR), window("7d", 33, 48 * HOUR)],
        fetchedAt: NOW,
      },
    },
    {
      id: "opencode-go",
      result: {
        ok: true,
        provider: "opencode-go",
        windows: [window("30d", 22, 22 * 24 * HOUR)],
        fetchedAt: NOW,
        resetCredits: 2,
      },
    },
  ]

  expect(formatUsageReport(results, NOW)).toBe(
    ["usage", "  oai  5h: 12% 1h · week: 33% 2d", "  go   month: 22% 22d · 2 resets"].join("\n"),
  )
})

test("the /usage report explains a provider it cannot read, and an empty one", () => {
  expect(
    formatUsageReport([{ id: "opencode-go", result: { ok: false, reason: "not_configured" } }], NOW),
  ).toBe(["usage", "  go  missing config"].join("\n"))

  expect(formatUsageReport([{ id: "openai", result: undefined }], NOW)).toBe(
    ["usage", "  oai  usage service unavailable"].join("\n"),
  )

  // Unconnected providers are filtered out entirely, leaving nothing to show.
  expect(formatUsageReport([{ id: "openai", result: { ok: false, reason: "no_connection" } }], NOW)).toBe(
    "usage: no providers configured in opencode",
  )
})

test("the compact segment drops expired windows and shows the provider closest to its limit", () => {
  const snapshot: UsageSnapshot = {
    stale: false,
    windows: {
      openai: [window("5h", 12, HOUR)],
      "opencode-go": [window("30d", 88, 22 * 24 * HOUR)],
    },
  }

  expect(usageGroups(snapshot, NOW).map((group) => group.label)).toEqual(["go", "oai"])
  // With room for one, the one that is nearly blocked.
  expect(usageGroups(snapshot, NOW, 1).map((group) => group.label)).toEqual(["go"])

  const expired: UsageSnapshot = { stale: false, windows: { openai: [window("5h", 12, -HOUR)] } }
  expect(usageGroups(expired, NOW)).toEqual([])
})

test("the selected model's provider leads, ahead of one closer to its limit", () => {
  const snapshot: UsageSnapshot = {
    stale: false,
    windows: {
      openai: [window("5h", 12, HOUR)],
      "opencode-go": [window("30d", 88, 22 * 24 * HOUR)],
    },
  }

  expect(usageGroups(snapshot, NOW, undefined, "openai").map((group) => group.label)).toEqual(["oai", "go"])
  // The budget keeps whichever led, so the one slot goes to where the next turn
  // will actually be spent.
  expect(usageGroups(snapshot, NOW, 1, "openai").map((group) => group.label)).toEqual(["oai"])

  // A provider with no reading of its own cannot lead, so the fallback order
  // stands -- as it does for a model on a provider with no adapter at all.
  const onlyGo: UsageSnapshot = { stale: false, windows: { "opencode-go": [window("30d", 88, 22 * 24 * HOUR)] } }
  expect(usageGroups(onlyGo, NOW, 1, "openai").map((group) => group.label)).toEqual(["go"])
  expect(usageGroups(snapshot, NOW, undefined, "anthropic").map((group) => group.label)).toEqual(["go", "oai"])
})

type RpcCall = { method: string; payload: { provider: string; force?: boolean } }

function sdk(input: { reply: (call: RpcCall) => unknown; calls?: RpcCall[] }) {
  return {
    plugin: {
      rpc: async (request: { method: string; payload?: unknown }) => {
        const call = { method: request.method, payload: request.payload as RpcCall["payload"] }
        input.calls?.push(call)
        return { data: input.reply(call) }
      },
    },
  } as unknown as OpenCodeClient
}

function ok(provider: string, percent: number) {
  return {
    ok: true,
    provider,
    windows: [{ category: "30d", label: "30d", percent, resetsAt: NOW + 22 * 24 * HOUR }],
    fetchedAt: NOW,
  }
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 20))
}

test("a poll fans out to every adapter and publishes what came back", async () => {
  const calls: RpcCall[] = []
  const snapshots: UsageSnapshot[] = []
  const usage = createProviderUsage({
    sdk: () => sdk({ calls, reply: (call) => ok(call.payload.provider, 22) }),
    focused: () => "focused",
    onChange: (snapshot) => snapshots.push(snapshot),
  })

  try {
    await settle()

    expect(calls.map((call) => call.payload.provider).sort()).toEqual(["openai", "opencode-go"])
    expect(calls.every((call) => call.method === "provider-usage.fetch")).toBe(true)
    expect(Object.keys(snapshots.at(-1)?.windows ?? {}).sort()).toEqual(["openai", "opencode-go"])
  } finally {
    usage.close()
  }
})

test("polling pauses while the terminal is blurred, and the values read as stale", async () => {
  const calls: RpcCall[] = []
  const snapshots: UsageSnapshot[] = []
  const usage = createProviderUsage({
    sdk: () => sdk({ calls, reply: (call) => ok(call.payload.provider, 22) }),
    focused: () => "blurred",
    onChange: (snapshot) => snapshots.push(snapshot),
  })

  try {
    await settle()

    expect(calls).toEqual([])
    expect(snapshots.at(-1)?.stale).toBe(true)
  } finally {
    usage.close()
  }
})

test("events arriving while blurred are the agent working, not the user returning", async () => {
  const calls: RpcCall[] = []
  const usage = createProviderUsage({
    sdk: () => sdk({ calls, reply: (call) => ok(call.payload.provider, 22) }),
    focused: () => "blurred",
    onChange: () => {},
  })

  try {
    await settle()
    usage.activity()
    await settle()

    expect(calls).toEqual([])
  } finally {
    usage.close()
  }
})

test("returning to the terminal revives the cadence and un-dims the reading", async () => {
  const calls: RpcCall[] = []
  const snapshots: UsageSnapshot[] = []
  let focused: "focused" | "blurred" = "blurred"
  const usage = createProviderUsage({
    sdk: () => sdk({ calls, reply: (call) => ok(call.payload.provider, 22) }),
    focused: () => focused,
    onChange: (snapshot) => snapshots.push(snapshot),
  })

  try {
    await settle()
    expect(calls).toEqual([])
    expect(snapshots.at(-1)?.stale).toBe(true)

    // What the lifecycle reports on focus or a keystroke, with the focus state
    // already updated -- unlike a stream event, this is the user.
    focused = "focused"
    usage.activity()
    await settle()

    expect(calls.length).toBe(2)
    expect(snapshots.at(-1)?.stale).toBe(false)
  } finally {
    usage.close()
  }
})

test("polling is suppressed entirely while disabled", async () => {
  const calls: RpcCall[] = []
  const usage = createProviderUsage({
    sdk: () => sdk({ calls, reply: (call) => ok(call.payload.provider, 22) }),
    focused: () => "focused",
    enabled: () => false,
    onChange: () => {},
  })

  try {
    await settle()
    expect(calls).toEqual([])
  } finally {
    usage.close()
  }
})

test("a provider that lost its connection stops showing a stale reading", async () => {
  const snapshots: UsageSnapshot[] = []
  const usage = createProviderUsage({
    sdk: () =>
      sdk({
        reply: (call) =>
          call.payload.provider === "openai"
            ? ok("openai", 40)
            : { ok: false, provider: "opencode-go", reason: "no_connection" },
      }),
    focused: () => "focused",
    onChange: (snapshot) => snapshots.push(snapshot),
  })

  try {
    await settle()
    expect(Object.keys(snapshots.at(-1)?.windows ?? {})).toEqual(["openai"])
  } finally {
    usage.close()
  }
})

test("a transient failure keeps the last good reading on screen", async () => {
  const snapshots: UsageSnapshot[] = []
  let fail = false
  const usage = createProviderUsage({
    sdk: () =>
      sdk({
        reply: (call) =>
          fail ? { ok: false, provider: call.payload.provider, reason: "fetch_failed" } : ok(call.payload.provider, 22),
      }),
    focused: () => "focused",
    onChange: (snapshot) => snapshots.push(snapshot),
  })

  try {
    await settle()
    expect(Object.keys(snapshots.at(-1)?.windows ?? {}).length).toBe(2)

    fail = true
    await usage.refresh()
    // Still there: a failed fetch says nothing about the quota itself.
    expect(Object.keys(snapshots.at(-1)?.windows ?? {}).length).toBe(2)
  } finally {
    usage.close()
  }
})

test("refresh forces past the server cache and returns every provider's answer", async () => {
  const calls: RpcCall[] = []
  const usage = createProviderUsage({
    sdk: () => sdk({ calls, reply: (call) => ok(call.payload.provider, 55) }),
    focused: () => "blurred",
    onChange: () => {},
  })

  try {
    await settle()
    expect(calls).toEqual([])

    const results = await usage.refresh()

    // Forced even though the poller itself was paused: /usage is presence.
    expect(calls.every((call) => call.payload.force === true)).toBe(true)
    expect(results.map((entry) => entry.id).sort()).toEqual(["openai", "opencode-go"])
    expect(results.every((entry) => entry.result?.ok)).toBe(true)
  } finally {
    usage.close()
  }
})

test("an RPC that throws is survived rather than propagated", async () => {
  const usage = createProviderUsage({
    sdk: () =>
      sdk({
        reply: () => {
          throw new Error("server plugin not loaded")
        },
      }),
    focused: () => "focused",
    onChange: () => {},
  })

  try {
    const results = await usage.refresh()
    expect(results.map((entry) => entry.result)).toEqual([undefined, undefined])
  } finally {
    usage.close()
  }
})
