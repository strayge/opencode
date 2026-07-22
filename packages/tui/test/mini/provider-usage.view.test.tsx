/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { createSignal } from "solid-js"
import { UsageSegment, usageGroupWidth, usageGroups } from "../../src/mini/provider-usage.view"
import type { UsageSnapshot } from "../../src/mini/provider-usage"
import { RUN_THEME_FALLBACK } from "../../src/mini/theme"

const HOUR = 3_600_000

function snapshot(input: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    stale: false,
    windows: {
      "opencode-go": [
        { category: "30d", label: "30d", percent: 22, resetsAt: Date.now() + 22 * 24 * HOUR },
      ],
    },
    ...input,
  }
}

async function render(input: { snapshot: UsageSnapshot; limit?: number; leading?: boolean; mono?: boolean }) {
  const [current] = createSignal(input.snapshot)
  const app = await testRender(
    () => (
      <box width={60} height={1} flexDirection="row">
        <UsageSegment
          snapshot={current}
          limit={() => input.limit}
          theme={() => RUN_THEME_FALLBACK.footer}
          leading={() => input.leading ?? false}
          mono={input.mono}
        />
      </box>
    ),
    { width: 60, height: 1 },
  )
  await app.renderOnce()
  return app
}

function colorOf(app: { captureSpans: () => { lines: { spans: { text: string; fg: RGBA }[] }[] } }, text: string) {
  const span = app
    .captureSpans()
    .lines.flatMap((line) => line.spans)
    .find((item) => item.text.includes(text))
  return span?.fg.toInts()
}

test("the compact segment reads as provider, percent, and time to reset", async () => {
  const app = await render({ snapshot: snapshot() })
  try {
    expect(app.captureCharFrame().trim()).toBe("go 22% 22d")
  } finally {
    app.renderer.destroy()
  }
})

test("a window label appears only when a provider shows more than one", async () => {
  const both = snapshot({
    windows: {
      "opencode-go": [
        { category: "5h", label: "5h", percent: 100, resetsAt: Date.now() + HOUR },
        { category: "30d", label: "30d", percent: 100, resetsAt: Date.now() + 22 * 24 * HOUR },
      ],
    },
  })
  const app = await render({ snapshot: both })
  try {
    const frame = app.captureCharFrame().trim()
    expect(frame).toContain("5h 100%")
    expect(frame).toContain("30d 100%")
  } finally {
    app.renderer.destroy()
  }
})

test("nothing is drawn before any answer has arrived", async () => {
  const app = await render({ snapshot: { windows: {}, stale: false } })
  try {
    expect(app.captureCharFrame().trim()).toBe("")
  } finally {
    app.renderer.destroy()
  }
})

test("the segment carries the separator in front of it, once, and only when it draws", async () => {
  const withLeading = await render({ snapshot: snapshot(), leading: true })
  try {
    // One leading mark, not one per group.
    expect(withLeading.captureCharFrame().trim()).toBe("· go 22% 22d")
  } finally {
    withLeading.renderer.destroy()
  }

  const withoutLeading = await render({ snapshot: snapshot(), leading: false })
  try {
    expect(withoutLeading.captureCharFrame().trim()).toBe("go 22% 22d")
  } finally {
    withoutLeading.renderer.destroy()
  }

  // Nothing to separate: no mark, so the sections either side close up as
  // though the segment were not there.
  const empty = await render({ snapshot: { windows: {}, stale: false }, leading: true })
  try {
    expect(empty.captureCharFrame().trim()).toBe("")
  } finally {
    empty.renderer.destroy()
  }
})

test("the countdown sits a step behind the percentage it qualifies", async () => {
  const app = await render({ snapshot: snapshot() })
  try {
    const muted = (RUN_THEME_FALLBACK.footer.muted as RGBA).toInts()
    expect(colorOf(app, "22%")).toEqual(muted)

    const countdown = colorOf(app, "22d")
    // Faded toward the statusline background, so `22% 22d` parses as a reading
    // and its qualifier rather than as one number written twice.
    expect(countdown).not.toEqual(muted)
    expect(countdown).not.toEqual((RUN_THEME_FALLBACK.footer.status as RGBA).toInts())
  } finally {
    app.renderer.destroy()
  }
})

test("mono keeps the countdown in the one colour that palette has", async () => {
  const app = await render({ snapshot: snapshot(), mono: true })
  try {
    expect(colorOf(app, "22d")).toEqual((RUN_THEME_FALLBACK.footer.muted as RGBA).toInts())
  } finally {
    app.renderer.destroy()
  }
})

test("mono uses the row's own separator, not the dotted one", async () => {
  const app = await render({ snapshot: snapshot(), leading: true, mono: true })
  try {
    expect(app.captureCharFrame().trim()).toBe("- go 22% 22d")
  } finally {
    app.renderer.destroy()
  }
})

test("the measured width matches what the segment draws", async () => {
  // The statusline budgets sections by this number, so a disagreement either
  // hides a provider that would have fit or pushes the sections after it off
  // the row -- neither of which shows up as a rendering bug.
  const both = snapshot({
    windows: {
      "opencode-go": [
        { category: "5h", label: "5h", percent: 100, resetsAt: Date.now() + HOUR },
        { category: "30d", label: "30d", percent: 7, resetsAt: Date.now() + 22 * 24 * HOUR },
      ],
    },
  })

  for (const input of [snapshot(), both]) {
    const app = await render({ snapshot: input })
    try {
      const [group] = usageGroups(input, Date.now())
      expect(usageGroupWidth(group!, Date.now())).toBe(app.captureCharFrame().trim().length)
    } finally {
      app.renderer.destroy()
    }
  }
})
