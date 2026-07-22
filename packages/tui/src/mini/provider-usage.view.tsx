/** @jsxImportSource @opentui/solid */
// The compact subscription-usage segment in the mini statusline.
//
// Text only -- `go 22% 22d`. The plugin's mini-bars cost another five or six
// columns per provider, which mini's single contended row cannot spare; the
// percent and the countdown are the actionable halves.
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { TextAttributes, parseColor } from "@opentui/core"
import { tint } from "../theme/color"
import { stringWidth } from "../util/string-width"
import {
  PREFERRED_WINDOW,
  PROVIDER_LABELS,
  formatDurationShort,
  percentOf,
  selectWindows,
  type ProviderId,
  type UsageWindow,
} from "./usage"
import type { UsageSnapshot } from "./provider-usage"
import type { RunFooterTheme } from "./theme"

// Countdowns are coarse -- minutes at the finest -- so this only has to be
// faster than the smallest unit it renders.
const TICK_MS = 30_000

// How far the countdown sits behind the rest of the segment. It qualifies the
// percentage rather than being a second reading of its own, and `22% 22d` in
// one flat colour reads as a single number twice. Blending toward the
// statusline's own background keeps the step proportional in every theme,
// which picking another palette slot would not.
//
// Kept modest on purpose: muted is already the dim tier, so every point of
// fade is contrast spent, and the stale DIM attribute rides on top of it.
const COUNTDOWN_FADE = 0.3

type Group = { id: ProviderId; label: string; windows: UsageWindow[] }

/**
 * Groups a snapshot into what the segment can draw.
 *
 * `current` is the provider the selected model belongs to, and leads when it
 * reports anything at all: that is the limit the next turn will actually spend
 * against, so it outranks a higher percentage somewhere the user is not
 * working. The rest fall back to closest-to-its-limit first, since a provider
 * at 4% is not news.
 *
 * `limit` is the responsive budget, applied after the ordering, so with room
 * for one it keeps whichever provider led.
 */
export function usageGroups(snapshot: UsageSnapshot, now: number, limit?: number, current?: string): Group[] {
  const groups: Group[] = []
  for (const id of Object.keys(snapshot.windows) as ProviderId[]) {
    // A window whose reset has passed is describing history; drop it rather
    // than render a countdown that has run out.
    const live = (snapshot.windows[id] ?? []).filter((window) => window.resetsAt > now)
    const windows = selectWindows(live, PREFERRED_WINDOW[id])
    if (windows.length > 0) groups.push({ id, label: PROVIDER_LABELS[id], windows })
  }

  const rank = (group: Group) => (group.id === current ? 0 : 1)
  groups.sort((left, right) => rank(left) - rank(right) || peak(right) - peak(left))
  return limit === undefined ? groups : groups.slice(0, Math.max(0, limit))
}

function peak(group: Group): number {
  return Math.max(...group.windows.map(percentOf))
}

/**
 * Columns one group occupies, so the statusline can decide how many fit.
 *
 * Mirrors what the component below renders, less the padding and the leading
 * mark the statusline policy budgets for every section. Keep the two in step:
 * over-reporting only costs a provider that would have fit, while
 * under-reporting pushes the sections after it off the row.
 */
export function usageGroupWidth(group: Group, now: number): number {
  const labelled = group.windows.length >= 2
  return group.windows.reduce(
    (total, window) =>
      total +
      (labelled ? 1 + stringWidth(window.label) : 0) +
      1 +
      stringWidth(`${percentOf(window)}%`) +
      1 +
      stringWidth(formatDurationShort(window.resetsAt - now)),
    stringWidth(group.label),
  )
}

export function UsageSegment(props: {
  snapshot: () => UsageSnapshot
  limit: () => number | undefined
  /** Provider id of the selected model, which leads the row when it reports. */
  current?: () => string | undefined
  theme: () => RunFooterTheme
  // Whether a statusline section already precedes this one. The row separates
  // its sections with a leading mark, so each section owns the one in front of
  // it -- and renders none at all when it has nothing to show.
  leading?: () => boolean
  mono?: boolean
}) {
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), TICK_MS)
  onCleanup(() => clearInterval(timer))

  const groups = createMemo(() => usageGroups(props.snapshot(), now(), props.limit(), props.current?.()))
  // Polling pauses when the user is away, so what is on screen may be minutes
  // old. Dimming says so without costing a column.
  const attrs = createMemo(() => (props.snapshot().stale ? TextAttributes.DIM : undefined))
  const color = (window: UsageWindow) =>
    percentOf(window) >= 100 ? props.theme().error : props.theme().muted
  // Mono has one colour to spend on everything, so the step back is skipped
  // there rather than invented -- a blend would be a shade that palette does
  // not have.
  const countdown = createMemo(() =>
    props.mono
      ? props.theme().muted
      : tint(parseColor(props.theme().muted), parseColor(props.theme().status), COUNTDOWN_FADE),
  )

  return (
    <For each={groups()}>
      {(group, index) => (
        <box paddingRight={1} backgroundColor="transparent" flexShrink={0}>
          <text fg={props.theme().muted} wrapMode="none" truncate attributes={attrs()}>
            <Show when={index() === 0 && props.leading?.()}>
              <span style={{ fg: props.theme().muted }}>{props.mono ? "- " : "· "}</span>
            </Show>
            {group.label}
            <For each={group.windows}>
              {(window) => (
                <>
                  {/* The window label only earns its width when a provider is
                      showing more than one and they need telling apart. */}
                  <Show when={group.windows.length >= 2}>
                    <span style={{ fg: props.theme().muted }}> {window.label}</span>
                  </Show>
                  <span style={{ fg: color(window) }}> {percentOf(window)}%</span>
                  <span style={{ fg: countdown() }}>{" " + formatDurationShort(window.resetsAt - now())}</span>
                </>
              )}
            </For>
          </text>
        </box>
      )}
    </For>
  )
}
