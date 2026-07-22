import { expect, test } from "bun:test"
import {
  alertFor,
  createMiniAttention,
  createTerminalFocus,
  type AttentionRenderer,
  type TerminalFocus,
} from "../../src/mini/attention"
import type { Config } from "../../src/config"

test("blocking requests alert whoever raised them, root session or subagent", () => {
  const permission = { type: "permission.v2.asked", data: { id: "per_1", sessionID: "ses_1" } }

  expect(alertFor(permission, true)).toEqual({ sound: "permission", message: "Permission needs input" })
  // A subagent waiting on a permission stops the turn just as hard.
  expect(alertFor(permission, false)).toEqual({ sound: "permission", message: "Permission needs input" })
})

test("form alerts carry the form title", () => {
  expect(alertFor({ type: "form.created", data: { form: { id: "frm_1", title: "Deployment" } } }, true)).toEqual({
    sound: "question",
    message: "Input needs response",
    title: "Deployment",
  })
  expect(alertFor({ type: "form.created", data: { form: { id: "frm_1" } } }, true)).toEqual({
    sound: "question",
    message: "Input needs response",
    title: undefined,
  })
})

test("completion alerts only for the root session", () => {
  expect(alertFor({ type: "session.execution.succeeded", data: { sessionID: "ses_1" } }, true)).toEqual({
    sound: "done",
    message: "Session done",
  })
  // A subagent finishing is a step inside a turn that announces itself later.
  expect(alertFor({ type: "session.execution.succeeded", data: { sessionID: "ses_2" } }, false)).toBeUndefined()
})

test("failures alert with the provider message, falling back to the tag", () => {
  expect(alertFor({ type: "session.execution.failed", data: { error: { message: "rate limited" } } }, true)).toEqual({
    sound: "error",
    message: "rate limited",
  })
  expect(alertFor({ type: "session.execution.failed", data: { error: { _tag: "ProviderError" } } }, true)).toEqual({
    sound: "error",
    message: "ProviderError",
  })
  expect(alertFor({ type: "session.execution.failed", data: {} }, true)).toEqual({
    sound: "error",
    message: "Session failed",
  })
})

test("user interruption is silent, and unrelated events raise nothing", () => {
  expect(alertFor({ type: "session.execution.interrupted", data: { reason: "user" } }, true)).toBeUndefined()
  expect(alertFor({ type: "session.step.started", data: {} }, true)).toBeUndefined()
  expect(alertFor({ type: "session.tool.called", data: {} }, true)).toBeUndefined()
})

type FakeRenderer = AttentionRenderer & {
  focus(): void
  blur(): void
  notifications: Array<{ message: string; title?: string }>
}

function renderer(): FakeRenderer {
  const listeners = new Map<string, () => void>()
  return {
    isDestroyed: false,
    notifications: [],
    on(event, listener) {
      listeners.set(event, listener)
    },
    off(event) {
      listeners.delete(event)
    },
    triggerNotification(message, title) {
      this.notifications.push({ message, title })
      return true
    },
    focus() {
      listeners.get("focus")?.()
    },
    blur() {
      listeners.get("blur")?.()
    },
  }
}

// Sound is off so the assertions ride on the notification path alone; the two
// share the same enable and focus gates inside core's attention host.
function config(overrides: Partial<Config.Resolved["attention"]> = {}): Pick<Config.Resolved, "attention"> {
  return {
    attention: {
      enabled: true,
      notifications: true,
      sound: false,
      volume: 0.4,
      sound_pack: "opencode.default",
      sounds: {},
      ...overrides,
    },
  }
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 20))
}

test("alerts fire while the terminal is blurred", async () => {
  const fake = renderer()
  const attention = createMiniAttention({ renderer: fake, config: config() })

  try {
    fake.blur()
    attention.handle({ type: "permission.v2.asked", data: { id: "per_1", sessionID: "ses_1" } }, true)
    await settle()

    expect(fake.notifications).toEqual([{ message: "Permission needs input", title: "OpenCode" }])
  } finally {
    attention.dispose()
  }
})

test("alerts stay quiet while the terminal is focused", async () => {
  const fake = renderer()
  const attention = createMiniAttention({ renderer: fake, config: config() })

  try {
    fake.focus()
    attention.handle({ type: "permission.v2.asked", data: { id: "per_1", sessionID: "ses_1" } }, true)
    attention.handle({ type: "session.execution.succeeded", data: { sessionID: "ses_1" } }, true)
    await settle()

    expect(fake.notifications).toEqual([])
  } finally {
    attention.dispose()
  }
})

test("unknown focus suppresses, so terminals that never report focus stay silent", async () => {
  const fake = renderer()
  const attention = createMiniAttention({ renderer: fake, config: config() })

  try {
    attention.handle({ type: "session.execution.succeeded", data: { sessionID: "ses_1" } }, true)
    await settle()

    expect(fake.notifications).toEqual([])
  } finally {
    attention.dispose()
  }
})

test("a disabled attention config raises nothing at all", async () => {
  const fake = renderer()
  const attention = createMiniAttention({ renderer: fake, config: config({ enabled: false }) })

  try {
    fake.blur()
    attention.handle({ type: "permission.v2.asked", data: { id: "per_1", sessionID: "ses_1" } }, true)
    await settle()

    expect(fake.notifications).toEqual([])
  } finally {
    attention.dispose()
  }
})

test("dispose detaches the focus listeners it registered", async () => {
  const fake = renderer()
  const attention = createMiniAttention({ renderer: fake, config: config() })

  fake.blur()
  attention.dispose()
  attention.handle({ type: "permission.v2.asked", data: { id: "per_1", sessionID: "ses_1" } }, true)
  await settle()

  expect(fake.notifications).toEqual([])
})

test("focus subscribers are notified after the state they are reacting to has changed", () => {
  const fake = renderer()
  const focus = createTerminalFocus(fake)
  const seen: Array<{ reported: TerminalFocus; current: TerminalFocus }> = []
  const off = focus.subscribe((reported) => seen.push({ reported, current: focus.current() }))

  try {
    // Nothing reported yet: terminals and multiplexers that never send focus
    // must not be mistaken for a user sitting there.
    expect(focus.current()).toBe("unknown")

    fake.blur()
    fake.focus()

    expect(seen).toEqual([
      { reported: "blurred", current: "blurred" },
      { reported: "focused", current: "focused" },
    ])

    off()
    fake.blur()
    expect(seen.length).toBe(2)
  } finally {
    focus.dispose()
  }
})
