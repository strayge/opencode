/** @jsxImportSource @opentui/solid */
// Steering a running subagent from the mini inspector.
//
// Mini's subagent inspector is otherwise read-only: it can watch a child and
// interrupt it, but not correct it. Steering adds the missing third verb.
//
// Everything specific to that lives here rather than in the inspector and
// footer view, so the upstream files carry only an import and a call site.
// The three pieces are the field, the mode it lives in, and the send.
import type { TextareaRenderable } from "@opentui/core"
import { createEffect, createSignal } from "solid-js"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Keymap } from "../context/keymap"
import type { RunFooterTheme } from "./theme"
import type { RunInput } from "./types"

/** @internal Exported for tests that drive submission without the inspector. */
export function SteerField(props: {
  theme: RunFooterTheme
  onSubmit: (text: string) => void
  onCancel: () => void
}) {
  let area: TextareaRenderable | undefined

  // The field only exists while steering is open, so focusing on mount is the
  // whole focus policy. The microtask defers past the renderable's own mount.
  createEffect(() => {
    queueMicrotask(() => {
      if (!area || area.isDestroyed) {
        return
      }

      area.focus()
    })
  })

  return (
    <textarea
      width="100%"
      minHeight={1}
      maxHeight={3}
      wrapMode="word"
      placeholder="Steer subagent..."
      placeholderColor={props.theme.muted}
      textColor={props.theme.text}
      focusedTextColor={props.theme.text}
      backgroundColor={props.theme.surface}
      focusedBackgroundColor={props.theme.surface}
      cursorColor={props.theme.text}
      focused
      onSubmit={() => {
        if (!area || area.isDestroyed) {
          return
        }

        const text = area.plainText.trim()
        if (!text) {
          return
        }

        // Cleared rather than closed, so corrections can be typed in sequence
        // while the child keeps running.
        area.setText("")
        props.onSubmit(text)
      }}
      onKeyDown={(event) => {
        if (event.name === "escape") {
          event.preventDefault()
          props.onCancel()
        }
      }}
      ref={(item) => {
        area = item
      }}
    />
  )
}

// Steering is a mode inside the inspector rather than an always-present input:
// the inspector binds j/k/arrows to scrolling, so a focused field by default
// would cost the ability to read a running subagent.
//
// `enabled` is the whole gate -- inspector open, on a running child, with a
// handler to send through. Losing any of it drops the field rather than leaving
// it focused over a session it can no longer reach.
export function createSubagentSteering(input: { enabled: () => boolean }) {
  const [steering, setSteering] = createSignal(false)

  Keymap.createLayer(() => ({
    enabled: input.enabled() && !steering(),
    priority: 1,
    commands: [
      {
        id: "subagent.steer",
        title: "Steer subagent",
        group: "Session",
        bind: "i",
        run: () => {
          setSteering(true)
        },
      },
    ],
  }))

  createEffect(() => {
    if (!input.enabled()) {
      setSteering(false)
    }
  })

  return {
    steering,
    close: () => setSteering(false),
  }
}

// Sends to the child session directly. "steer" delivery is what every mini
// prompt already uses: the server admits the message durably and promotes it at
// the child's next safe step boundary, so a correction typed mid-turn lands
// without racing the tool call in flight.
export function steerSubagent(input: {
  sdk: RunInput["sdk"]
  sessionID: string
  text: string
}): { messageID: string; sent: Promise<unknown> } {
  const messageID = SessionMessage.ID.create()
  return {
    messageID,
    sent: input.sdk.session.prompt({
      sessionID: input.sessionID,
      id: messageID,
      text: input.text,
      delivery: "steer",
    }),
  }
}
