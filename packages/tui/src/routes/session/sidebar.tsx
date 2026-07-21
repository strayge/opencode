import { useData } from "../../context/data"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useConfig } from "../../config"
import { PluginSlot } from "../../plugin/render"
import { withTimestampedFallback } from "@opencode-ai/util/session-title-fallback"

import { getScrollAcceleration } from "../../util/scroll"
import { SESSION_SIDEBAR_WIDTH } from "../../ui/layout"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const data = useData()
  const theme = useTheme("elevated")
  const config = useConfig().data
  const session = createMemo(() => data.session.get(props.sessionID))
  const scrollAcceleration = createMemo(() => getScrollAcceleration(config))
  // Stable object with reactive getters so slot views subscribe without being
  // recreated. Tokens are the sidebar's own elevated set, so a contribution
  // matches the surface it sits on rather than the transcript's.
  const footerLeadingSlotInput = {
    get sessionID() {
      return props.sessionID
    },
    theme: {
      get text() {
        return theme.text.default
      },
      get textSubdued() {
        return theme.text.subdued
      },
      get accent() {
        return theme.hue.accent[500]
      },
    },
  }

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.background.default}
        width={SESSION_SIDEBAR_WIDTH}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox
          ref={(scroll) =>
            queueMicrotask(() => {
              if (!scroll.isDestroyed) scroll.verticalScrollBar.resetVisibilityControl()
            })
          }
          flexGrow={1}
          scrollAcceleration={scrollAcceleration()}
          verticalScrollbarOptions={{
            visible: false,
            trackOptions: {
              backgroundColor: theme.background.default,
              foregroundColor: theme.scrollbar.default,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            <box paddingRight={1}>
              <text fg={theme.text.default}>
                <b>{withTimestampedFallback(session()!)}</b>
              </text>
              <Show when={session()!.location.workspaceID}>
                <text fg={theme.text.subdued}>{session()!.location.workspaceID}</text>
              </Show>
            </box>
            <PluginSlot name="sidebar.content" input={{ sessionID: props.sessionID }} mode="all" />
            <Show when={session()?.parentID}>
              <PluginSlot name="session.sidebar.child" input={{ sessionID: props.sessionID }} mode="all" />
            </Show>
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          {/* Ungapped wrapper so a leading contribution reads as another line of
              the same block as the footer's own path, not a separate section. */}
          <box flexShrink={0}>
            <PluginSlot name="sidebar.footer.leading" input={footerLeadingSlotInput} mode="all" />
            <PluginSlot name="sidebar.footer" input={{}} mode="replace" />
          </box>
        </box>
      </box>
    </Show>
  )
}
