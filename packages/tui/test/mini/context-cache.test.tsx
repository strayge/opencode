/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import {
  CACHE_MAX_AGE_MS,
  ContextUsage,
  cacheExpired,
  cacheExpiryDelay,
  splitUsage,
} from "../../src/mini/context-cache"
import { RUN_THEME_FALLBACK, RUN_THEME_MONO } from "../../src/mini/theme"

test("cache expiry is measured from the turn that produced the reading", () => {
  const now = 10_000_000

  expect(cacheExpired(now, now)).toBe(false)
  expect(cacheExpired(now - CACHE_MAX_AGE_MS + 1, now)).toBe(false)
  expect(cacheExpired(now - CACHE_MAX_AGE_MS, now)).toBe(true)
  expect(cacheExpired(undefined, now)).toBe(false)
})

test("cache expiry delay counts down to the lapse and floors at zero", () => {
  const now = 10_000_000

  expect(cacheExpiryDelay(now, now)).toBe(CACHE_MAX_AGE_MS)
  expect(cacheExpiryDelay(now - 1_000, now)).toBe(CACHE_MAX_AGE_MS - 1_000)
  expect(cacheExpiryDelay(now - CACHE_MAX_AGE_MS * 2, now)).toBe(0)
  expect(cacheExpiryDelay(undefined, now)).toBeUndefined()
})

test("usage splits into context and cost so only context can go stale", () => {
  expect(splitUsage("159.6K (16%) · $4.23")).toEqual({ context: "159.6K (16%)", cost: "$4.23" })
  expect(splitUsage("159.6K (16%)")).toEqual({ context: "159.6K (16%)" })
  expect(splitUsage("")).toEqual({ context: "" })
})

async function renderUsage(input: { usage: string; usageAt?: number; mono?: boolean }) {
  const [usageAt, setUsageAt] = createSignal(input.usageAt)
  const app = await testRender(
    () => (
      <box width={60} height={1}>
        <text>
          <ContextUsage
            usage={() => input.usage}
            usageAt={usageAt}
            theme={() => (input.mono ? RUN_THEME_MONO.footer : RUN_THEME_FALLBACK.footer)}
            mono={input.mono}
          />
        </text>
      </box>
    ),
    { width: 60, height: 1 },
  )

  return { ...app, setUsageAt }
}

function colorOf(app: { captureSpans: () => { lines: { spans: { text: string; fg: RGBA }[] }[] } }, text: string) {
  const span = app
    .captureSpans()
    .lines.flatMap((line) => line.spans)
    .find((item) => item.text.includes(text))
  return span?.fg.toInts()
}

test("fresh context usage renders both halves in the muted colour", async () => {
  const app = await renderUsage({ usage: "159.6K (16%) · $4.23", usageAt: Date.now() })

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()

    expect(frame).toContain("159.6K (16%)")
    expect(frame).toContain("$4.23")
    expect(frame).toContain("·")
    expect(colorOf(app, "159.6K")).toEqual((RUN_THEME_FALLBACK.footer.muted as RGBA).toInts())
    expect(colorOf(app, "$4.23")).toEqual((RUN_THEME_FALLBACK.footer.muted as RGBA).toInts())
  } finally {
    app.renderer.destroy()
  }
})

test("a lapsed cache colours the context reading but leaves the cost alone", async () => {
  const app = await renderUsage({
    usage: "159.6K (16%) · $4.23",
    usageAt: Date.now() - CACHE_MAX_AGE_MS,
  })

  try {
    await app.renderOnce()

    expect(colorOf(app, "159.6K")).toEqual((RUN_THEME_FALLBACK.footer.error as RGBA).toInts())
    expect(colorOf(app, "$4.23")).toEqual((RUN_THEME_FALLBACK.footer.muted as RGBA).toInts())
    // Colour is the whole signal outside mono -- the reading itself is unchanged.
    expect(app.captureCharFrame()).toContain("159.6K (16%) · $4.23")
  } finally {
    app.renderer.destroy()
  }
})

test("usage with no recorded turn never reads as stale", async () => {
  const app = await renderUsage({ usage: "159.6K (16%)", mono: true })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("!")
  } finally {
    app.renderer.destroy()
  }
})

test("mono marks a lapsed cache with a character, having no error colour to spend", async () => {
  const app = await renderUsage({
    usage: "159.6K (16%) · $4.23",
    usageAt: Date.now() - CACHE_MAX_AGE_MS,
    mono: true,
  })

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()

    // Marker rides the context half only; the cost of a past turn is a fact.
    expect(frame).toContain("159.6K (16%)!")
    expect(frame).toContain("$4.23")
    expect(frame).toContain(" - ")
    expect(frame).not.toContain("·")
  } finally {
    app.renderer.destroy()
  }
})

test("a new turn clears staleness", async () => {
  const app = await renderUsage({
    usage: "159.6K (16%)",
    usageAt: Date.now() - CACHE_MAX_AGE_MS,
    mono: true,
  })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("159.6K (16%)!")

    app.setUsageAt(Date.now())
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("!")
  } finally {
    app.renderer.destroy()
  }
})
