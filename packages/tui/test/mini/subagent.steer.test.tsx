/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { Keymap } from "../../src/context/keymap"
import { RunFooterSubagentBody, SUBAGENT_INSPECTOR_ROWS } from "../../src/mini/footer.subagent"
import { SteerField } from "../../src/mini/subagent.steer"
import { RUN_THEME_FALLBACK } from "../../src/mini/theme"
import type { FooterSubagentTab } from "../../src/mini/types"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const tuiConfig = createTuiResolvedConfig()

function subagent(input: {
  sessionID: string
  label: string
  description: string
  status?: FooterSubagentTab["status"]
}) {
  return {
    sessionID: input.sessionID,
    label: input.label,
    description: input.description,
    status: input.status ?? "running",
  } satisfies FooterSubagentTab
}

test("direct subagent steer field submits trimmed text and clears", async () => {
  const submits: string[] = []

  const app = await testRender(
    () => (
      <box width={100} height={4}>
        <Keymap.Provider config={tuiConfig}>
          <SteerField
            theme={RUN_THEME_FALLBACK.footer}
            onSubmit={(text) => {
              submits.push(text)
            }}
            onCancel={() => {}}
          />
        </Keymap.Provider>
      </box>
    ),
    { width: 100, height: 4, kittyKeyboard: true },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Steer subagent...")
    "use bun  ".split("").forEach((key) => app.mockInput.pressKey(key))
    await app.renderOnce()
    app.mockInput.pressEnter()
    await app.renderOnce()

    expect(submits).toEqual(["use bun"])
    // Cleared for the next correction rather than closing the field.
    expect(app.captureCharFrame()).toContain("Steer subagent...")

    app.mockInput.pressEnter()
    await app.renderOnce()
    expect(submits).toEqual(["use bun"])
  } finally {
    app.renderer.currentFocusedRenderable?.blur()
    app.renderer.currentFocusedEditor?.blur()
    app.renderer.destroy()
  }
})

test("direct subagent inspector routes escape to the steer field, not the inspector", async () => {
  const [tab] = createSignal(subagent({ sessionID: "s-1", label: "Explore", description: "Inspect auth flow" }))
  const [steering, setSteering] = createSignal(true)
  const steers: string[] = []
  let closed = 0
  let cancelled = 0

  const app = await testRender(
    () => (
      <box width={100} height={SUBAGENT_INSPECTOR_ROWS}>
        <Keymap.Provider config={tuiConfig}>
          <RunFooterSubagentBody
            active={() => true}
            theme={() => RUN_THEME_FALLBACK}
            tab={tab}
            index={() => 1}
            total={() => 1}
            detail={() => undefined}
            onCycle={() => {}}
            onClose={() => {
              closed += 1
            }}
            steering={steering}
            steer={() => "i"}
            onSteer={(text) => {
              steers.push(text)
            }}
            onSteerCancel={() => {
              cancelled += 1
              setSteering(false)
            }}
          />
        </Keymap.Provider>
      </box>
    ),
    { width: 100, height: SUBAGENT_INSPECTOR_ROWS, kittyKeyboard: true },
  )

  try {
    await app.renderOnce()
    "wait".split("").forEach((key) => app.mockInput.pressKey(key))
    await app.renderOnce()
    app.mockInput.pressEnter()
    await app.renderOnce()
    expect(steers).toEqual(["wait"])

    app.mockInput.pressEscape()
    await app.renderOnce()
    expect(cancelled).toBe(1)
    expect(closed).toBe(0)

    // Field gone, so escape belongs to the inspector again.
    app.mockInput.pressEscape()
    await app.renderOnce()
    expect(closed).toBe(1)
  } finally {
    app.renderer.currentFocusedRenderable?.blur()
    app.renderer.currentFocusedEditor?.blur()
    app.renderer.destroy()
  }
})

test("direct subagent inspector hints the steer shortcut only while reading", async () => {
  const [tab] = createSignal(subagent({ sessionID: "s-1", label: "Explore", description: "Inspect auth flow" }))
  const [steering, setSteering] = createSignal(false)

  const app = await testRender(
    () => (
      <box width={100} height={SUBAGENT_INSPECTOR_ROWS}>
        <Keymap.Provider config={tuiConfig}>
          <RunFooterSubagentBody
            active={() => true}
            theme={() => RUN_THEME_FALLBACK}
            tab={tab}
            index={() => 1}
            total={() => 1}
            detail={() => undefined}
            onCycle={() => {}}
            onClose={() => {}}
            steering={steering}
            steer={() => "i"}
            onSteer={() => {}}
            onSteerCancel={() => {}}
          />
        </Keymap.Provider>
      </box>
    ),
    { width: 100, height: SUBAGENT_INSPECTOR_ROWS, kittyKeyboard: true },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("i steer")

    setSteering(true)
    await app.renderOnce()
    const frame = app.captureCharFrame()

    expect(frame).not.toContain("i steer")
    expect(frame).toContain("Steer subagent...")
  } finally {
    app.renderer.currentFocusedRenderable?.blur()
    app.renderer.currentFocusedEditor?.blur()
    app.renderer.destroy()
  }
})

test("direct subagent inspector offers no steer surface for a finished subagent", async () => {
  const [tab] = createSignal(
    subagent({ sessionID: "s-1", label: "Explore", description: "Inspect auth flow", status: "completed" }),
  )

  const app = await testRender(
    () => (
      <box width={100} height={SUBAGENT_INSPECTOR_ROWS}>
        <Keymap.Provider config={tuiConfig}>
          <RunFooterSubagentBody
            active={() => true}
            theme={() => RUN_THEME_FALLBACK}
            tab={tab}
            index={() => 1}
            total={() => 1}
            detail={() => undefined}
            onCycle={() => {}}
            onClose={() => {}}
            steering={() => false}
            steer={() => "i"}
            onSteer={() => {}}
            onSteerCancel={() => {}}
          />
        </Keymap.Provider>
      </box>
    ),
    { width: 100, height: SUBAGENT_INSPECTOR_ROWS, kittyKeyboard: true },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("i steer")
  } finally {
    app.renderer.destroy()
  }
})
