# Fork Changes

This fork adds a small set of plugin integration points on top of upstream
`v2`. The goal is to unlock a suite of external plugins (provider usage bars,
subagent steering/navigation, attention notifications, terminal status glyphs,
token totals, markdown copy) while keeping every change tiny and additive so
rebases onto newer upstream stay cheap. Plugin code itself lives outside this
repository; only the extension seams live here.

The fork's own commits are the contiguous run at the tip of the branch —
everything below them is upstream — so the base is the parent of the oldest fork
commit, and `git merge-base HEAD v2` finds it. No sha is recorded here on
purpose: a literal one rots silently, while the derivation is self-checking.
Sanity check it by size — against the correct base the fork is roughly 50 files
and 3.4k insertions. If a diff reports hundreds of files, the base is wrong, not
the fork.

Entries are grouped by the surface they touch. **Item numbers are permanent
IDs, not an ordering** — they were assigned in the order the changes landed and
never change, so a number stays valid in commit messages and cross-references
even as entries are regrouped. Numbers 14–17 are plain upstream bug fixes rather
than seams, and 21 is fork-local tooling; each lives in its own section.

Each entry carries the same fields:

- **Files** — what it touches.
- **What** / **Why** — the change and its motivation.
- **Invariant** — the behavior to re-derive from if upstream moves the code out
  from under the diff. This is the field to read when a rebase conflicts.
- **Rebase** — the shape of the diff and where it will collide.
- **Drop when** — the upstream change that makes this entry deletable. Absent
  where the only exit is upstream shipping the same seam.

## Index

| # | Seam | Kind | Consumer plugin |
| --- | --- | --- | --- |
| 1 | `session.prompt.footer.leading` | slot mount | provider-usage |
| 18 | `session.prompt.footer.trailing` | slot mount | sidebar-toggle |
| 2 | `session.prompt.right` | slot mount | *none yet* |
| 13 | `session.prompt.context` | replacement slot | context-cache-status |
| 4 | `session.prompt.below` + child-session steering | slot gate + behavior | subagent-steering |
| 3 | `session.message.assistant.footer` | slot mount | *none yet* |
| 9 | `session.sidebar.child` + child sidebar | slot gate + behavior | subagent-navigation |
| 19 | `sidebar.footer.leading` | slot mount | git-branch |
| 20 | `home.footer.directory.trailing` | slot mount | git-branch |
| 10 | `session.prompt.hidden` + `app.bottom.hidden` | slot gate + behavior | focus-mode |
| 5 | `context.terminal` focus API | context API | attention-notifications, terminal-status, provider-usage |
| 6 | `context.attention` + terminal-title decorations | context API | attention-notifications, terminal-status |
| 7 | Clipboard/selection + alternate-copy transforms | context API | markdown-copy |
| 8 | Plugin RPC endpoint | backend seam | provider-usage |
| 11 | Shared framework runtime | loader seam | every rendering plugin |
| 12 | `prompt.location` / `prompt.palette` | config option | *`cli.json` only* |

Upstream fixes:

- [14 — `fs.watch` fallback](#14-fswatch-fallback-when-the-native-watcher-is-unavailable)
- [15 — turn wall-clock duration](#15-turn-wall-clock-duration-in-the-assistant-footer)
- [16 — catalog-aware session restore](#16-session-agentmodel-restore-waits-for-the-catalog)
- [17 — selection copy blank rows](#17-selection-copy-preserves-blank-layout-rows)
- [22 — steering a subagent from mini](#22-steering-a-running-subagent-from-the-mini-inspector)
- [23 — prompt-cache staleness in mini](#23-prompt-cache-staleness-in-the-mini-statusline)
- [24 — attention alerts in mini](#24-attention-alerts-in-mini)
- [25 — branch on the mini splash](#25-checked-out-branch-on-the-mini-splash)
- [26 — provider usage in mini](#26-provider-subscription-usage-in-mini)
- [27 — `/model` in mini](#27-model-in-mini)
- [28 — remembered model in mini](#28-mini-remembers-the-selected-model)
- [29 — variant survives a filling catalog](#29-a-restored-variant-survives-a-filling-catalog)

Fork tooling:

- [21 — `build-custom.sh`](#21-build-customsh-versioned-local-builds)

## The slot-presence gate

Items 4, 9, and 10 share one pattern, described here once. A slot registration
is used as a *presence-only* switch: core reads `plugins.slot(name).length > 0`
as a reactive memo and changes layout accordingly, while the slot's rendered
content is incidental (often nothing at all). Registering or unregistering
through the imperative handle returned by `context.ui.slot` therefore toggles
the behavior live.

The property that makes this acceptable in a fork: **with no plugin registered,
the layout is byte-for-byte upstream.** The gate adds a term to an existing
condition rather than replacing the condition, so upstream expressions stay
verbatim and merges re-anchor cleanly.

## Seams

### Prompt row

#### 1. `session.prompt.footer.leading` slot

**Files:** `packages/tui/src/component/prompt/index.tsx`

**What:** A V2 `PluginSlot` mounted at the *start* of the Prompt's bottom row,
ahead of the left hint/location box. Slot input is a stable object with
reactive getters: `{ sessionID?, status: "idle" | "running",
mode: "normal" | "shell" }`. This is the slot for content that should read as
part of the status line and sit *before* the working-directory label — e.g. a
persistent usage indicator. Empty when unregistered (the `For` yields nothing),
so it costs no layout for users without such a plugin.

**Why:** V2 plugins previously had no mount point attached to the input box —
only `app.bottom` (a separate full-width row across all routes). Plugins that
show prompt-local status (provider quota bars, token counters, pending-steer
indicators) need to render inside the prompt footer. Because the row lives in
the shared `Prompt` component, the slot works on both the home and session
routes.

**Invariant:** renders at the start of the Prompt's bottom row, before the
working-directory label.

**Rebase:** a one-line-ish mount plus a small input object, inside the `Prompt`
component. Conflicts, if any, are trivial.

#### 18. `session.prompt.footer.trailing` slot

**Files:** `packages/tui/src/component/prompt/index.tsx`,
`packages/tui/src/routes/session/index.tsx`

**What:** A V2 `PluginSlot` mounted at the *end* of the Prompt's bottom row,
past the agents/commands hints — the mirror of item 1, which mounts at that
row's start. Slot input is a stable object with reactive getters:
`{ sessionID?, status: "idle" | "running", mode: "normal" | "shell",
sidebar?: boolean, theme }`, where `theme` exposes `text`, `textSubdued`, and
`accent`. Empty when unregistered, so it costs no layout for users without such
a plugin.

`sidebar` is a new optional `PromptProps` field passed by the session route from
its existing `sidebarVisible()` memo, and it is the only consumer of that prop.
It is undefined wherever the shared Prompt renders without a sidebar (the home
route), which is how a plugin distinguishes "hidden" from "no sidebar here".

**Why:** The right end of the status line is where a control belongs — the
leading slot is claimed by persistent readouts (usage bars) and everything
between is core-owned status. Item 1 gave plugins the row's start only, so a
plugin had no way to put anything after core's own hints. The added input fields
are what a control needs that a readout does not: theme tokens to render an
on/off appearance in-theme, and the sidebar state, since the panel a footer
control most naturally targets is owned by the route rather than the Prompt.
Reporting the route's state rather than letting a plugin track its own keeps
the two from disagreeing after a keyboard toggle, a wide-terminal auto-open, or
a focus-mode collapse.

**Invariant:** renders at the end of the Prompt's bottom row, after core's own
hints.

**Rebase:** same shape as item 1, plus a `sidebar` prop passed from the session
route's `Prompt` element, next to the `right=` prop upstream already passes
there.

#### 2. `session.prompt.right` slot

**Files:** `packages/tui/src/component/prompt/index.tsx`

**What:** A V2 `PluginSlot` rendered next to the legacy `session_prompt_right`
slot in the Prompt's `right` cluster (the TPS/AVG/TTFT area), with
`{ sessionID }` input. Mounted inside the `Prompt` component (next to the
`props.right` render), not in the session route, so the route's `right=` prop
stays byte-for-byte upstream.

**Why:** The legacy slot API (`session_prompt_right`) is not reachable from
the current V2 plugin runtime — the legacy `TuiPluginRuntime` is never
initialized by the v2 CLI, so nothing can register into it. This exposes the
same position through the V2 `context.ui.slot` registry.

**Invariant:** exposes the legacy `session_prompt_right` position through the V2
registry, without touching the route's `right=` prop.

**Rebase:** trivial mount inside the `Prompt` component.

**Note:** no plugin in the suite registers this slot yet. It is the cheapest
entry to drop if the fork is ever trimmed to what is actually consumed.

#### 13. `session.prompt.context` replacement slot

**Files:** `packages/tui/src/component/prompt/index.tsx`,
`packages/tui/src/util/session.ts`

**What:** An inline V2 `PluginSlot` mounted in place of the built-in prompt
context value (`9.0K (1%)`). When no plugin registers the slot, the built-in
span renders unchanged. Slot input is a stable object with reactive getters:
`{ sessionID?, tokens?, percent?, text?, updatedAt?, theme }`; `theme` exposes
`textSubdued` and `error`. Core continues to own the surrounding live-work
status, separators, cost, truncation, and empty-state behavior.

**Why:** Context presentation policy can depend on information outside core,
such as provider-specific cache assumptions. A replacement seam lets a plugin
style or annotate the existing value without duplicating the complete status
cluster or embedding that policy in the fork. `updatedAt` is the creation time
of the assistant message supplying the displayed usage.

**Invariant:** the slot replaces only the built-in context span; the surrounding
separator and cost branches stay core's, so plugins own the context rendering
and not the complete status cluster.

**Rebase:** contained to the context span; preserve the surrounding branches.

### Prompt body

#### 4. `session.prompt.below` slot + prompt steering in child sessions

**Files:** `packages/tui/src/routes/session/index.tsx`,
`packages/tui/src/component/prompt/index.tsx`

**What:** A V2 `PluginSlot` with a `{ sessionID, theme }` input, mounted inside
the shared `Prompt` component between the in-box status line (agent · model ·
provider · variant) and the footer/path row, so plugin content lands directly
under the input box and above the working-directory row. `theme` carries the
Prompt's own tokens (`border`, `divider`, `background`, `text`, `textSubdued`,
`accent`, `success`, `error`) as reactive getters so a prompt-adjacent plugin
can frame itself as part of the input cluster (Prompt left border + elevated
background) rather than reading as more transcript output; plugins have no theme
access of their own.

Registering into this slot is also the opt-in switch for child-session steering
(see [the slot-presence gate](#the-slot-presence-gate)): while at least one
plugin renders it, child sessions stop force-opening the Composer and render the
normal `Prompt` instead (placeholder "Steer subagent...", slot content below
it). Because `session.prompt.below` lives inside the `Prompt`, it renders only
when the Prompt does (so focus mode, permission, and form states hide it
automatically) and is available on the home route too (harmless — a subagent
switcher renders nothing there).

Supporting pieces, live only in steering mode:

- A finished subagent (an idle child session) can no longer be steered, so the
  input is hidden entirely: instead of the Prompt, a dedicated `<Match>` renders
  the `session.prompt.below` slot on its own (the subagent switcher with no text
  input or status line). Steering input is only present while the subagent is
  running. This is why `session.prompt.below` is mounted in two mutually
  exclusive spots — inside the Prompt (running) and standalone in the route
  Switch (finished).
- The Prompt takes an `onEscape` override that replaces escape-to-interrupt
  (double-press abort) with a single-press return to the parent session
  (works while the subagent is idle too; the running hint reads `esc back`
  instead of `esc interrupt`).
- The arrow-bound child navigation commands (`session.parent`,
  `session.child.next/previous`) fall through when the focused editor has
  text — without this they shadow the app-level textarea layer
  (later-registered layers win keymap ties) and steal cursor keys from the
  steering input.
- `session.child.first` can still open the Composer manually in a child view
  (e.g. for the shell tab). While open it is upstream's interactive composer,
  Prompt hidden — including the subagents tab's escape action navigating to
  the parent session.

Permission and form prompts keep higher priority than the Prompt, unchanged.
The subagent list/switching UI itself (sibling tabs, status, navigation
bindings, interrupt) lives in a plugin rendered through this slot, built on
existing plugin APIs: `context.data.session.family/status`,
`context.ui.router.navigate`, plugin keymap layers, and
`context.client.api.session.interrupt`.

**Why:** Steering a running subagent was already fully supported by the
backend — `session.prompt` defaults to `delivery: "steer"`
(`packages/core/src/session.ts`), which admits input durably and promotes it
at the next safe step boundary. The only missing piece was UI: the child view
forced the Composer open and suppressed the Prompt entirely, so there was no
way to type into a subagent. Rendering the existing Prompt (rather than a new
plugin input surface) preserves autocomplete, attachments, paste handling,
and history for free. Keeping the list UI in a plugin lets
`composer/index.tsx` stay pristine upstream and shrinks the route edit to a
slot mount plus one `!steering()` term on each of the two upstream force-open
conditions.

**Invariant:** when `session.prompt.below` has a registration, child sessions
render slot + Prompt instead of the forced Composer.

**Rebase:** no longer touches the Composer. In the session route the two
upstream force-open conditions each gain a `!steering()` term (upstream
expressions kept verbatim, so merges re-anchor cleanly); the rest is additive
(memo, the slot mount below the Prompt, Prompt props, editor-has-text
fallthrough).

**Drop when:** upstream renders a Prompt in child sessions itself.

### Transcript

#### 3. `session.message.assistant.footer` slot

**Files:** `packages/tui/src/routes/session/index.tsx`,
`packages/tui/src/plugin/slot-inputs.ts` (new)

**What:** The assistant metadata row (`Agent · Model · duration`) in
`AssistantFooter` is now a flex row with a V2 slot appended. Input:
`{ sessionID, messageID, agent, providerID, modelID, variant?, tokens?,
cost?, completed, duration? }`. The slot-input builder lives in
`packages/tui/src/plugin/slot-inputs.ts` (`assistantFooterSlotInput`), so the
route edit is a single mount line rather than a ~35-line reactive-getter object
in the hottest TUI file.

**Why:** Lets plugins attach per-message information (token usage, cost,
custom status) beside the built-in metadata, in both root and child
transcripts, with one mount point.

**Invariant:** one mount in the assistant metadata row, with the input object
built outside the route.

**Rebase:** the slot-input builder's new file has no conflict surface; the route
carries a single mount line.

**Note:** no plugin in the suite registers this slot yet.

### Sidebar and home

#### 9. `session.sidebar.child` slot + sidebar in child sessions

**Files:** `packages/tui/src/routes/session/index.tsx`,
`packages/tui/src/routes/session/sidebar.tsx`

**What:** A V2 `PluginSlot` mounted in the Sidebar below `sidebar.content`,
rendered only when the session has a `parentID`, with `{ sessionID }` input.
Like item 4, registration doubles as the opt-in — but it gates only the
*auto-open default*, not the toggle. In `sidebarVisible` the manual-toggle
(`sidebarOpen`) check runs first, so `session.sidebar.toggle` (show/hide) works
in a child session regardless of registration; the child gate below it only
suppresses the config-`auto` auto-open. So: with a plugin registered, a child
auto-opens the sidebar like a root; with none registered, a child stays hidden
by default (upstream behaviour) but the user can still show it manually.

**Why:** Subagent-navigation plugins render the session family tree in the
sidebar; hiding the sidebar in child views made that list disappear exactly
where "go back to parent / jump to sibling" matters most. The gate cannot
reuse `sidebar.content` presence because upstream's built-in feature-plugins
(mcp, context, lsp) always register it — a dedicated name is what makes
"registered" equivalent to "wants child sidebars". The slot-gated default makes
the sidebar present in child views without any state syncing, so the manual
`sidebarOpen` signal stays route-local (upstream-local) rather than being
hoisted to persist across parent/child navigation.

**Invariant:** a manual toggle must win in child views, and `childSidebar()`
gates only the auto-open default. The order matters — the `sidebarOpen` check
must stay before the child gate, or the toggle becomes a dead no-op in child
views.

**Rebase:** reorders `sidebarVisible` so the `sidebarOpen()` check comes before
the child gate, then adds `if (session()?.parentID && !childSidebar()) return
false` above the config-auto line. The sidebar mount is additive.

#### 19. `sidebar.footer.leading` slot

**Files:** `packages/tui/src/routes/session/sidebar.tsx`

**What:** A V2 `PluginSlot` mounted *above* the existing `sidebar.footer` slot,
with both wrapped in an ungapped box inside the footer's `gap={1}` container so
a contribution reads as another line of the same block as the built-in working
directory rather than a separate section. Slot input is a stable object with
reactive getters: `{ sessionID, theme }`, where `theme` exposes `text`,
`textSubdued`, and `accent` from the sidebar's own `contextual("elevated")`
tokens, so a contribution matches the surface it sits on.

**Why:** `sidebar.footer` already exists, but slot order is plugin registration
order (`slot(name)` flat-maps `Object.values(store.registrations)`) and built-in
plugins register first. The path line is one of them
(`feature-plugins/sidebar/footer.tsx`, `opencode.sidebar-footer`), so an
external plugin registering the same slot can only ever render *below* it. A
leading mount is the only way to put a line above the path without either
reordering registrations — which would change resolution for every slot — or
giving the built-in footer plugin knowledge of what wants to sit above it.

**Invariant:** `sidebar.footer.leading` renders immediately above
`sidebar.footer`, with no gap row between them.

**Rebase:** a slot-input object plus a mount, wrapping upstream's
`sidebar.footer` mount in an extra ungapped box. If upstream restructures that
footer, re-derive from the invariant.

#### 20. `home.footer.directory.trailing` slot

**Files:** `packages/tui/src/feature-plugins/home/footer.tsx`

**What:** A V2 `PluginSlot` mounted inside the built-in home-footer plugin's
row, between its working directory and its MCP indicator. Slot input is a
stable object with reactive getters: `{ theme }`, exposing `text`,
`textSubdued`, and `accent`. Unlike items 1, 18, and 19, this one mounts inside
a *feature plugin* rather than a route or a shared component, because that
plugin — not the route — owns the row.

**Limitation:** the directory's `maxWidth` budget deliberately does not account
for the slot: it already subtracts the version and MCP widths, and a
contribution's width is not knowable there. Contributed content is expected to
shrink or truncate instead, so a long path keeps its space.

**Why:** Same ordering constraint as item 19, one axis over. The home route's
`home.footer` slot renders into a column, so a second registration becomes a
whole new row rather than joining the existing one — and registration order
would put it below the built-in regardless. Anything meant to read as a
continuation of the working directory has to mount inside that row.

**Invariant:** the slot renders inline immediately after the working directory,
before the MCP indicator.

**Rebase:** a slot-input object plus a mount, and a `PluginSlot` import in a file
that had none.

### Session-wide gates

#### 10. `session.prompt.hidden` + `app.bottom.hidden` slots + focus (read-only) mode

**Files:** `packages/tui/src/routes/session/index.tsx`,
`packages/tui/src/app.tsx`

**What:** Two presence-only V2 slot gates following the pattern of items 4
and 9.

- `promptHidden = plugins.slot("session.prompt.hidden").length > 0` (in the
  session route). While at least one active plugin registers this slot, every
  input surface — the `session.composer.top` slot, the Composer, and the Prompt
  — is gated off so the transcript scrollbox reclaims the full height, turning
  the session into a read-only output view. The wrapping `<box flexShrink={0}>`
  stays mounted (an empty flexShrink box is zero rows), so the gate is expressed
  as per-surface `!promptHidden()` terms rather than an outer wrapper — this
  keeps the box at upstream's indentation and avoids re-indenting the whole
  cluster.
- `appBottomHidden = plugins.slot("app.bottom.hidden").length > 0` (in
  `app.tsx`), wrapping `<PluginSlot name="app.bottom" />` in
  `Show when={!appBottomHidden()}`. The `app.bottom` slot lives at the App
  level, above the session route, so a route-scoped gate cannot reach it — hence
  a distinct gate in `app.tsx`. This lets a read-only view reclaim the bottom
  status region (e.g. the provider-usage bars) along with the input cluster; the
  `focus-mode` plugin registers both slots together.

Two deliberate asymmetries, both in the route:

- **Required input still shows.** The permission and form `<Match>` branches
  carry no `promptHidden` term, so a pending permission or form prompt renders
  through the existing `<Switch>` even in focus mode; only the composer trio
  (behind `Show when={!promptHidden()}`) and the plain Prompt `<Match>` (gated
  `!promptHidden() && !disabled()`) drop out. Focus mode never swallows a prompt
  the user has to answer.
- **Sidebar close is one-way.** A `createEffect(on(promptHidden, …))` closes the
  sidebar on the false→true transition if it is visible, and never reopens it on
  show. It calls the shared `setSidebar(false)` helper (config
  `session.sidebar: "hide"` + `setSidebarOpen(false)`), the same primitive the
  `session.sidebar.toggle` command uses, so the two can never disagree. The
  coupling lives in the route because visibility (`sidebarVisible()`) and the
  manual `sidebarOpen` signal are route-local and unreachable from a TUI plugin.

**Why:** On small terminals the input row and its hints eat several rows that
are more useful as transcript while reading back a long session. The seam keeps
core minimal (render gating + the one sidebar side effect only the route can
express) while the actual policy — the toggle command, its keybinding, palette
and slash discoverability, and enablement — lives in an external `focus-mode`
plugin that just registers/unregisters the slots.

**Invariant:** when `session.prompt.hidden` has a registration, gate off the
composer trio and the plain Prompt, but leave the permission/form branches alone
so required input still renders.

**Rebase:** leaves the `<box flexShrink={0}>` at upstream indentation; the gate
is three small edits inside it — a `Show when={!promptHidden()}` around the
composer trio, a leading `!promptHidden() &&` on the `<Switch>`'s first
`<Match>`, and a `!promptHidden() &&` on the last `<Match when={!disabled()}>`
(both upstream expressions kept verbatim after the added term). The
`promptHidden` memo and the sidebar-coupling effect are purely additive. The
`app.bottom.hidden` gate is one `createMemo` plus a `Show` wrapper in `app.tsx`.

### Plugin context

Items 5, 6, and 7 center on one new provider file
(`packages/tui/src/context/terminal.tsx`) mounted around `PluginProvider`, plus
new fields on the V2 plugin context type
(`packages/plugin/src/v2/tui/context.ts`, `packages/tui/src/plugin/context.tsx`).

#### 5. `context.terminal` focus API (V2 TUI plugins)

**Files:** `packages/tui/src/context/terminal.tsx` (new),
`packages/tui/src/plugin/context.tsx`, `packages/plugin/src/v2/tui/context.ts`,
`packages/tui/src/app.tsx` (provider mount)

**What:** New `TerminalProvider` tracks renderer `focus`/`blur` events into a
reactive `"unknown" | "focused" | "blurred"` state. Exposed to V2 plugins as
`context.terminal.focused()/onFocus()/onBlur()` with cleanup tied to the
plugin scope.

**Why:** Focus-aware behavior (suppressing notification sounds while the
terminal is focused, clearing title status glyphs on focus) is impossible
without focus visibility. The renderer already emitted these events; nothing
exposed them to V2 plugins.

**Invariant:** focus state is observable to plugins with three values, the third
(`"unknown"`) distinguishing "not yet reported" from "blurred".

**Rebase:** additive — a new provider file plus context-type fields.

#### 6. `context.attention` + terminal-title decorations

**Files:** same as item 5

**What:** Two APIs sharing the `TerminalProvider` wiring:

- The existing but dormant attention host (`packages/tui/src/attention.ts`,
  sound packs + notifications + focus policies) is now instantiated in the v2
  app and exposed as `context.attention` (`notify`, `soundboard`). The TUI
  config already parsed and resolved the `attention` section; it was simply
  never wired. Note: `attention.enabled` defaults to `false` upstream, so
  sounds require opting in via `cli.json`.
- Terminal-title decorations. Plugins call
  `context.terminal.title.decorate({ id, priority, prefix?, suffix? })`.
  `TerminalProvider` wraps `renderer.setTerminalTitle` on mount (restoring it on
  cleanup): the application keeps computing and writing the base title exactly
  as upstream does, the wrapper captures that base into a signal, and a
  provider-owned effect re-writes `base + decorations` whenever the base or any
  decoration changes. So plugin contributions can never be clobbered by route or
  session-title changes and are removed on plugin unload. An empty base (the
  app's "title disabled" clear) passes through raw, so decorations cannot
  resurrect a title the app removed.

**Why:** In the v2 binary the legacy TUI plugin runtime (which exposed
`api.attention` and raw renderer access) is dead code — the v2 CLI never
initializes it, so the v2 TUI shipped with no notification sounds at all and
no safe way for plugins to touch the terminal title. Raw
`renderer.setTerminalTitle()` writes from plugins would race the app's own
reactive title effect; the decoration registry removes that race by
construction.

**Invariant:** `app.tsx`'s title effect stays **byte-for-byte upstream** —
decorations are applied by wrapping `setTerminalTitle` inside `TerminalProvider`,
not by rewriting the app's title effect into `base + compose()`. That is what
keeps this hot file free of a title-decoration diff.

**Rebase:** additive, in the same provider file as item 5.

#### 7. Clipboard/selection context + alternate-copy transforms

**Files:** same as item 5, plus `packages/tui/src/util/selection.ts`,
`packages/tui/src/app.tsx`, `packages/tui/src/ui/dialog.tsx`

**What:** `context.clipboard.write(text)` (pass-through to the existing
`ClipboardService` with OSC52/native fallbacks) and
`context.terminal.selection()` returning a snapshot
`{ text, renderables }` of the active mouse selection.

`context.clipboard.selection.transform({ id, priority?, run })` registers a
scope-owned synchronous transformer for the alternate copy gesture. Having any
transform registered reactively enables explicit selection copy (core's
`terminal.copy_on_select` config option remains an independent override). Plain
`ctrl+c` / right-click keep the built-in rendered copy; `ctrl+shift+c` runs
transforms in descending priority order. The right-click path also routes Shift
when the terminal reports it, but plugins must not rely on that gesture because
terminals commonly reserve it for paste. The first string result wins. No result
or a thrown transform falls back to rendered text. Clipboard writing, toast, and
selection clearing remain in the existing centralized `Selection.copy` path;
unloading the final transformer restores copy-on-select unless the option turns
it off.

The "explicit selection copy is on" predicate (copy-on-select is off OR any
registered transform) is a single exported helper, `explicitSelectionCopy`, in
`terminal.tsx`, shared by every copy-gesture call site in `app.tsx` and
`ui/dialog.tsx` rather than re-inlined at each. `ui/dialog.tsx` reads the
terminal context optionally (`useOptionalTerminal`) so dialogs render without a
`TerminalProvider` in tests; with no provider there is no config to read, so the
helper reports core's default rather than silently switching those renders to
explicit copy.

Core's own default — `terminal.copy_on_select ?? process.platform !== "win32"`,
i.e. on everywhere but Windows — is resolved once as
`selectionCopy.copyOnSelect()` on the terminal context. Upstream inlines that
same expression at each of its call sites; keeping the fork's single resolution
is what stops the two from disagreeing about which gesture copies. Note the
polarity: core's option says copy-on-select is *enabled*, while the predicate
above is true when explicit copy is wanted, so the helper negates it.

**Why:** Enables copy-oriented plugins — in particular markdown copy:
terminal selection copies rendered text, but selected renderables can be
mapped back to `MarkdownRenderable.content` (the original markdown source).
`Renderable` was already part of the public V2 plugin API surface
(`KeymapLayer.target`), so this adds no new type exposure.

**Invariant:** unmodified copy is byte-for-byte behaviorally unchanged, and
modified copy falls back to it when no transform handles the selection.

**Rebase:** the `app.tsx` / `ui/dialog.tsx` edits swap the inline copy-on-select
flag check for the shared `explicitSelectionCopy(terminal)` helper and pass the
optional transform only when Shift is held.

### Backend

#### 8. Plugin RPC endpoint

**Files:** `packages/core/src/plugin/rpc.ts` (new; imports `makeLocationNode`
from `@opencode-ai/util/effect/app-node`, which upstream extracted out of
`packages/core/src/effect/`),
`packages/protocol/src/groups/plugin.ts`, `packages/protocol/src/errors.ts`,
`packages/server/src/handlers/plugin.ts`, `packages/core/src/plugin/{host,promise}.ts`,
`packages/core/src/location-services.ts`, `packages/plugin/src/v2/{effect,promise}/rpc.ts`,
and regenerated `packages/client/src/**`

**What:** A generic request channel from any OpenCode client to server
plugins:

- `PluginRpc` registry service (`packages/core/src/plugin/rpc.ts`): flat
  method namespace per Location; registrations are scoped, so unloading the
  owning plugin removes its handlers; duplicate registration is a defect.
- Server-plugin context gains `context.rpc.register(method, handler)` and
  `context.rpc.call(method, payload)` in both the effect and promise APIs
  (`packages/plugin/src/v2/{effect,promise}/rpc.ts`, host wiring in
  `packages/core/src/plugin/host.ts`, promise adapter in
  `packages/core/src/plugin/promise.ts`).
- Protocol endpoint `POST /api/plugin/rpc/:method`
  (`packages/protocol/src/groups/plugin.ts`) with
  `PluginRpcMethodNotFoundError` (404) / `PluginRpcError` (500), handled in
  `packages/server/src/handlers/plugin.ts`. Payload and result are
  plugin-defined JSON (`Schema.Unknown`).
- Client regenerated: `client.plugin.rpc({ method, payload })`, which TUI
  plugins reach through `context.client`. (The generated `PluginApi` type
  therefore includes `rpc`, so the host also implements `context.plugin.rpc`
  as a thin delegate to the registry.)

Method names should be prefixed with the plugin ID (e.g.
`provider-usage.list`) since the namespace is flat.

**Why:** Server plugins already have everything needed to build services like
a provider-quota fetcher — including credential access via
`context.integration.connection.active/resolve`, which must stay server-side.
What was missing was any transport for a TUI plugin (a separate process,
possibly a remote client) to request data from a server plugin. One generic
endpoint replaces the alternative of adding provider-specific quota APIs to
core: adapters live in plugins, credentials never reach the TUI, and future
server-plugin services need no further protocol changes.

**Invariant:** one generic, plugin-defined-JSON transport; no provider-specific
schemas in core.

**Rebase:** almost entirely new files. Shared-file edits are import/entry
additions (`location-services.ts`, `plugin.ts` node deps, protocol group, server
handler) plus regenerated client output — **rerun `bun run generate` in
`packages/client` after rebasing instead of resolving conflicts in
`packages/client/src/**`.**

### Loader

#### 11. Shared framework runtime for rendering plugins

**Files:** `packages/tui/src/plugin/context.tsx`

**What:** At the top of the V2 plugin loader module, the host calls
`ensureRuntimePluginSupport()` from
`@opentui/solid/runtime-plugin-support/configure` — once, before any plugin is
imported. This is the same primitive the V1 TUI plugin runtime
(`packages/opencode/src/plugin/tui/runtime.ts`) already uses; the V2 loader is a
separate boot path that never initializes that runtime, so it must make the call
itself. It is called with no `additional` modules: the V2 plugins reach
keybindings through the host `context.keymap` API and never import
`@opentui/keymap` themselves, so only the default set needs sharing (importing a
second `@opentui/keymap` subpath here also collides its pre-bundled chunk during
`bun build --compile`).

**Why:** A TUI plugin is a *rendering* plugin — it ships SolidJS components that
mount into the host's live `@opentui` renderer. `solid-js`, `@opentui/core`, and
`@opentui/solid` keep critical state in module-level singletons: `solid-js`
tracks the current reactive owner/listener, `@opentui/core` owns the renderer,
`@opentui/solid` is the reconciler bridging them. A second copy of any of them
gives the plugin its own reactive graph, so signals/effects it creates are
invisible to the host renderer — renderables never mount, effects never fire, or
it crashes.

`ensureRuntimePluginSupport` captures the host's already-loaded runtime module
namespaces (solid, solid/store, the JSX runtimes, `@opentui/core`, and
`@opentui/solid`) and registers a `Bun.plugin` whose `onLoad` returns those live
objects for a plugin's bare `solid-js` / `@opentui/*` imports. Because it hands
back the in-memory module — not a filesystem path — it dedupes to the host
instance regardless of where the plugin loads from (an arbitrary directory or
the isolated package cache) and regardless of whether the plugin brought its own
on-disk copy. Crucially it resolves *nothing from disk*, so it works in a
`bun build --compile` binary where those packages live only inside the
executable and cannot be linked or walked up to. It also needs no writes into
plugin directories.

**Invariant:** the plugin must import the *same instances* of the framework
modules as the host, not compatible copies.

**Rebase:** confined to the V2 plugin loader module — one import and a single
top-level call. Everything is additive; no upstream logic is edited. Depends on
`@opentui/solid` exposing `runtime-plugin-support/configure`; revisit if the
`@opentui` major changes.

**Drop when:** upstream ships its own V2 rendering-plugin loader with
runtime-plugin-support already wired. The primitive is idempotent
(global-symbol guard), so a duplicate call is harmless in the meantime.

### Config

#### 12. `prompt.location` / `prompt.palette` config options

**Files:** `packages/tui/src/config/index.tsx`,
`packages/tui/src/component/prompt/index.tsx`

**What:** Two new optional booleans in the TUI config's `prompt` section,
set in `cli.json`. `prompt.location: false` suppresses the working-directory
label that the Prompt renders in its footer row while the session is idle
(`locationLabel`). `prompt.palette: false` suppresses the command palette
shortcut hint (`ctrl+p commands`) in the same row's right cluster (normal mode
only; the shell-mode `esc exit shell mode` hint is unaffected). Unset or `true`
keeps upstream behavior for each.

**Why:** The directory label repeats information already visible elsewhere
(terminal title, shell prompt), and the palette hint is static muscle-memory
text; both compete for footer-row width with plugin content in the
`session.prompt.footer.leading` slot. Upstream exposes no toggle for either,
and both are core rendering next to the slot — not inside it — so no plugin can
remove them.

**Invariant:** `prompt.location: false` means the working-directory label never
renders; `prompt.palette: false` means the `commands` shortcut hint never
renders.

**Rebase:** two optional fields appended to the `prompt` struct in the TUI config
schema, an early-return line at the top of the `locationLabel` memo, and a
`<Show when={config.prompt?.palette !== false}>` wrapper around the palette-hint
`<text>` in the footer's normal-mode branch. All should merge cleanly.

## Upstream fixes

These are not extension seams — they are plain fixes carried on top of upstream,
and each should be dropped the moment upstream fixes it. No plugin consumes any
of them.

#### 14. `fs.watch` fallback when the native watcher is unavailable

**Files:** `packages/core/src/filesystem/watcher.ts`

**What:** `subscribeDirectory` no longer gives up when the `@parcel/watcher`
native binding or the platform backend is missing. Instead of logging an error
and returning no subscription, it logs a warning and falls back to Node's
non-recursive `fs.watch` on the directory, publishing normalized
`{ path, type: "update" }` events into the same pubsub the Parcel path uses.
Error logging and the `unsubscribe` shape match the existing file-watch branch,
so the rest of the service (ref counting, finalizers, stream wiring) is
untouched. The native watcher stays preferred whenever it loads — it is the only
path with recursive watching and `ignore` support; the fallback only covers
directly watched files and directories.

**Why:** In the compiled Bun executable the platform-specific binding is loaded
through `createRequire(import.meta.url)`, which does not guarantee that
`watcher.node` is embedded in the artifact. The resulting throw is swallowed by
the optional loader (`lazy(... catch { return })`), leaving the watcher service
with no directory backend at all. The visible symptom is that config hot reload
dies: edits to `opencode.json` are not picked up until the background service
restarts. The fallback restores that reload path in compiled builds.

**Invariant:** a missing native binding or unsupported backend must still yield a
working subscription object rather than `undefined`, so the caller registers an
entry and hot reload keeps working.

**Rebase:** replaces the early-out branch at the top of `subscribeDirectory`;
everything below it (the Parcel subscribe path) is untouched.

**Drop when:** upstream makes the binding load reliably under
`bun build --compile`.

#### 15. Turn wall-clock duration in the assistant footer

**Files:** `packages/tui/src/routes/session/index.tsx`

**What:** `AssistantFooter` measures its duration from the first assistant
message of the turn instead of from the message it renders for. It walks back
through the session's message list, stopping at the first `user`, `synthetic`,
or `compaction` message, and takes the earliest assistant `time.created` it
crossed. Formatting, placement, and the interrupted branch are untouched.

**Why:** Each step of a turn is a separate assistant message
(`session.step.started` closes the current one and appends a new one), and only
the terminal step — the one whose `finish` is not `tool-calls`/`unknown` —
renders a footer. Measuring `completed - created` on that message therefore
reported the latency of the final request alone, so a turn that spent minutes in
tools showed seconds. Subagent-heavy turns were the worst case: all the `task`
time sits in earlier step messages that never render a footer. V1 avoided this
by measuring from the parent user message, but V2 dropped `parentID` from the
assistant schema. Anchoring on the turn's first step keeps the wall-clock
reading while excluding time a queued prompt spent waiting to start. The `mini`
runtime already reports true wall time, so this also makes the two surfaces
agree.

**Invariant:** the footer reports wall time from the turn's first provider
request to the terminal step's completion, not the terminal step's own latency.

**Rebase:** contained to the `duration` memo in `AssistantFooter` (plus a
`useData()` call in the same component). Note the sibling `AssistantMessage`
component has the same per-message bug but is dead code in V2 — left untouched
to keep the diff minimal.

**Drop when:** upstream restores a turn/parent link on assistant messages and
uses it here.

#### 16. Session agent/model restore waits for the catalog

**Files:** `packages/tui/src/component/prompt/index.tsx`

**What:** The Prompt effect that seeds agent/model/variant from the durable V2
session state now also waits for the agent list and the location's model list to
be populated, not just for the local `model.json` read (`local.model.ready`).
Until both are non-empty the effect returns without marking the session synced,
so it re-runs — both lists are reactive — as soon as the data lands.

**Why:** A cold server answers `/api/model` with an empty list for the first
seconds (catalog assembly, integration availability). `isModelValid` cannot tell
an unloaded list from an unknown model, so restoring a session in that window
warned `Model <provider>/<model> is not valid` for a perfectly valid model, and
`local.model.set` bailed out. Since the effect marked the session synced anyway,
it never retried: the restored session silently ran on the fallback model (first
valid entry in `recent`) instead of its own, with the same hazard for the agent
(`local.agent.set` on an empty list toasts `Agent not found`). Gating on data
presence keeps the restore correct rather than papering over the warning in
`isModelValid`, which would let a genuinely missing model be stored.

**Invariant:** the restore must not consume its one-shot `syncedSessionID` latch
before the agent and model lists it reads are loaded.

**Rebase:** one guard line at the top of the session-restore effect in the
Prompt.

**Drop when:** upstream gives `model.list()` a distinct loading state, or has
`isModelValid` treat one as unknown.

#### 17. Selection copy preserves blank layout rows

**Files:** `packages/tui/src/util/selection.ts`,
`packages/tui/src/util/selection-text.ts` (new)

**What:** `copy()` composes the clipboard text through a new
`util/selection-text.ts` helper instead of calling
`selection.getSelectedText()` directly. The helper keeps OpenTUI's row map
(`Map<y, {x, text}[]>`, segments joined by column) and additionally tracks which
rows each contributing renderable's *text* covers, as `[y, y + visualRows)`.
Walking from the topmost to the bottommost occupied row, a mapped row is
emitted, an unmapped but covered row is skipped, and an unmapped uncovered row
becomes an empty line. Bounds come from occupied rows rather than from the
selection rectangle, so no leading or trailing blank lines appear. When nothing
places itself on a row it defers to `selection.getSelectedText()`, which returns
`""` for an empty selection and keeps the `if (!text) return false` guard intact.

Two geometry facts make the coverage test necessary, and both are easy to get
wrong:

- `getSelectedText()` yields *logical* lines and leaves soft wraps unbroken, so
  `renderable.y + lineIndex` does not address visual rows — a paragraph wrapping
  to three rows reports one line. Upstream uses that expression as a sort key
  only, so the mismatch is invisible there; filling by row arithmetic alone turns
  every wrap-consumed row into a spurious blank line.
- Box height is not text extent. A list marker is laid out at the height of the
  whole list item, so the one-row `"5. "` of a long item reports a height of 11.
  Using height for coverage lets that marker claim every gap row inside the item
  and silently deletes the blank lines between paragraphs nested in a list —
  the exact case this fix exists for. `visualRows` therefore reads the text
  buffer's virtual (wrapped) line count, capped by height so a clipped
  renderable never claims rows it does not draw.

Renderables whose text extent is unavailable fall back to height. That is the
conservative direction: it can only under-report blank rows, never invent them.

**Why:** OpenTUI's `Selection.getSelectedText()` uses row numbers for sorting
only, then joins the populated rows with a single newline — so a row nothing
wrote to vanishes. `MarkdownRenderable` separates top-level blocks with a yoga
margin (`getInterBlockMargin` returns 1) rather than with text, and loose list
items get `marginTop` the same way. Copying a multi-paragraph assistant message
therefore ran every paragraph together, both for plain `ctrl+c` and for the
Shift-modified copy, whose transforms substitute into this same text.

**Limitation:** a long drag with autoscroll inside a `ScrollBox` can leave rows
unoccupied that were not visually blank, since `walkSelectableRenderables`
filters by selection bounds against current layout positions. That case
previously concatenated the rows instead; both results are wrong, and gap-capping
heuristics would break the normal case, so it is left alone.

**Invariant:** a row that nothing wrote to, and that no contributing
renderable's text covers, becomes an empty line in the copied text.

**Rebase:** one call site in `copy()` (`selection.getSelectedText()` →
`selectedText(selection)`) plus an import; the composition itself lives in the
new `util/selection-text.ts`, which has no conflict surface. The changed line
sits in the two-line gap between two hunks item 7 already owns, so it widens an
existing hunk instead of adding a new one. The helper duck-types on
`x`/`y`/`height`/`getSelectedText` rather than on `isRenderable`, keeping the
upstream `FocusableSelectionTarget` declaration untouched. This is a
reimplementation of an `@opentui/core` internal that additionally reaches
through `textBufferView.getVirtualLineCount()`: a dependency bump that changes
`Selection.getSelectedText()`, the layout of list markers, or that accessor will
not surface as a rebase conflict, so re-check the helper when the `@opentui`
version moves. `test/util/selection-text.render.test.ts` is the guard — it
drives a real renderer and a real mouse drag, and it catches every regression
the hand-built fixtures in `selection-text.test.ts` missed.

**Drop when:** upstream OpenTUI starts materializing blank rows itself.

### Mini

The entries in this section target `opencode mini`, and they are native code
rather than plugins for one reason: **mini has no plugin host, and this fork
deliberately does not give it one.**

`createPluginRuntime()` is called in exactly one place —
`packages/tui/src/app.tsx` — and mini never mounts `app.tsx`. There is no slot
host, no `TuiPluginApi`, and no loader anywhere under
`packages/tui/src/mini/`. Three consequences follow:

- Every plugin exporting `./tui` is inert under mini, which is nearly all of the
  ones this fork exists to serve.
- Every **server** plugin works untouched, because it runs in the server process
  that mini connects to over the same SDK. `model-discovery` needs nothing: the
  models it injects already reach mini's picker through `loadRunProviders`.
- Slot names are full-TUI coordinates. `session.prompt.*`, `sidebar.*`,
  `home.*` and `app.bottom` all name surfaces mini does not have, so a mini slot
  host would need its own vocabulary. It is not a re-mount of the existing one.

So each mini entry ports a plugin's *behaviour* rather than the plugin, and the
sizes justify that. Attention alerts (24) and the server half of provider usage
(26) need no UI slot at all; prompt-cache staleness (23) and subagent steering
(22) are one line of state and one argument respectively. Routing those through
a plugin API would be more machinery than feature. A mini slot host, by
contrast, means a new slot vocabulary, a loader, a shared-runtime seam, and
lifecycle ownership inside a footer that is deliberately a single row with a
width budget — `mini/footer.width.ts` gates every segment by terminal width.
That is a large fork surface to carry against upstream, for features that mostly
do not render.

**The bar for revisiting:** wanting *third-party* plugins in mini, or the native
versions starting to diverge in behaviour from the full-TUI plugins they mirror.
Until then, native code in `mini/` is smaller, is testable with the existing
`packages/tui/test/mini/` suite, and rebases more cheaply.

Not every plugin gets a mini entry, and the reasons differ. `markdown-copy` has
nothing to attach to and nothing to fix: mini writes to the real terminal
scrollback, so selection and copy are the terminal's own. `terminal-status` is
simply not ported yet — and will be simpler here than in the full TUI, because
mini never calls `renderer.setTerminalTitle`, so there is no app-owned base
title to compose with and item 6's `title.decorate` priority machinery is
unnecessary. Mini can own the title outright, reusing entry 24's event mapping
and entry 26's `createTerminalFocus`.

#### 22. Steering a running subagent from the mini inspector

**Files:** `packages/tui/src/mini/subagent.steer.tsx` (new),
`packages/tui/src/mini/footer.subagent.tsx`, `packages/tui/src/mini/footer.view.tsx`,
`packages/tui/src/mini/footer.ts`, `packages/tui/src/mini/runtime.lifecycle.ts`,
`packages/tui/src/mini/runtime.ts`

**What:** The mini subagent inspector gains a steering field. It is a mode, not
a persistent input: hidden by default, opened with `subagent.steer` (`i`),
closed by escape before escape reaches the inspector. While it is open the
inspector's `useKeyboard` returns early so the field owns every key. Submitting
sends `session.prompt` to the *child* `sessionID` with `delivery: "steer"`, then
clears the field so corrections can be typed in sequence. The field, the mode,
and the send all live in the new `subagent.steer.tsx`; the upstream files carry
the props, an import, and the call sites.

**Why:** Mini could watch a subagent and interrupt it, but not correct it — the
inspector replaces the whole footer body, so there is no composer to type into
while it is open, and the backend capability went unused. The full TUI reaches
the same behavior through the `session.prompt.below` gate (entry 4), which needs
a plugin; mini has no plugin host, so the behavior is inlined instead. Delivery
semantics are unchanged from what mini already does — every mini prompt is sent
as `steer`, and only the target session is new.

**Invariant:** steering exists exactly while the inspector is open on a *running*
child with a send handler attached; losing any of those drops the field rather
than leaving it focused over a session it can no longer reach. Escape closes the
field before it closes the inspector. The scroll and cycle keys keep working
whenever the field is closed.

**Rebase:** the bulk is a new file with no conflict surface. What lands in
upstream files is additive and adjacent to the existing `onSubagentInterrupt`
path — a prop on four hop points (`footer.view` → `footer.ts` →
`runtime.lifecycle.ts` → `runtime.ts`), which merges silently unless upstream
rewrites that chain. The riskier hunks are the four inside
`footer.subagent.tsx`: a guard clause at the top of `useKeyboard`, a hint in the
header row, and the field as a new sibling below the transcript box. If upstream
restructures the inspector's layout, re-derive from the invariant rather than
replaying the diff. `test/mini/subagent.steer.test.tsx` is the guard and is
likewise a new file.

**Drop when:** upstream adds steering to the mini inspector, or mini grows a
plugin host that entry 4's plugin can target.

#### 23. Prompt-cache staleness in the mini statusline

**Files:** `packages/tui/src/mini/context-cache.tsx` (new),
`packages/tui/src/mini/stream-v2.transport.ts`, `packages/tui/src/mini/footer.view.tsx`,
`packages/tui/src/mini/footer.ts`, `packages/tui/src/mini/types.ts`

**What:** The statusline's context reading turns red once the prompt cache
behind it is assumed dead. `FooterState` gains `usageAt`, set by the transport
from `session.step.started`'s `created` and emitted with the usage at
`session.step.ended`; `ContextUsage` splits the reading into its context and
cost halves and colours only the context one, re-arming a timer each turn so the
colour flips at the lapse rather than at the next event. Mono has no error
colour — every slot in that palette is the foreground — so staleness is a
trailing `!` there instead.

**Why:** The same policy as the `context-cache-status` plugin (entry 13's
consumer), which mini cannot run: it has no plugin host. The number is the
question "how much context", the colour is the question "what will it cost to
send again", and only the second one changes while you are away. Anchoring on
the step's *start* rather than its end matches entry 13's `updatedAt` (the
assistant message's creation time), so the two surfaces agree; for a turn that
runs minutes the difference is real but well inside an hour.

**Invariant:** the clock is per-turn, not per-session — it restarts on every
assistant response — and only the context half of the reading carries the
colour. A session resumed from history shows no staleness until its first turn
completes, because nothing else writes `usage`.

**Rebase:** additive throughout. In the transport the two new lines ride beside
the existing `stepModel` writes in the same three branches (started, ended,
failed), so they widen existing hunks rather than adding new ones; in
`footer.view.tsx` the JSX swap replaces `{activityMeta()}` with a component and
moves the mono separator into it. `splitUsage` splits on the `" · "` the
transport joins with — if upstream changes that separator this degrades to
colouring the whole reading, which over-colours rather than breaking.
`test/mini/context-cache.test.tsx` is the guard and asserts real span colours
through `captureSpans()`.

**Drop when:** upstream reports actual cache lifetimes, or mini grows a plugin
host that the `context-cache-status` plugin can target.

#### 24. Attention alerts in mini

**Files:** `packages/tui/src/mini/attention.ts` (new),
`packages/tui/src/mini/stream-v2.transport.ts`, `packages/tui/src/mini/runtime.lifecycle.ts`,
`packages/tui/src/mini/runtime.ts`, `packages/tui/src/mini/types.ts`

**What:** Mini plays a sound and raises a desktop notification when a turn
needs the user — permission asked, form created, session done, session failed.
The machinery is core's own `createTuiAttention`, which already owns the enable
gate, the focus gate, sound packs, volume, per-sound overrides, and the OS
notification, and which takes a structurally-typed renderer that mini's
`CliRenderer` already satisfies. What the fork adds is the mapping from stream
event to alert, one `onEvent` hook in the transport's `apply`, and construction
in the lifecycle. `RunTuiConfig` widens by one key so mini can read
`attention.*` — the same config block the full TUI uses, `enabled: false` by
default.

**Why:** The `attention-notifications` plugin cannot run under mini, which has
no plugin host. Unlike that plugin the fork does *not* reimplement the focus
gate: the plugin passes `when: "always"` and gates itself only because it wants
an `unknownFocus: "allow"` option and a postpone window, neither of which mini
needs. Passing `when: "blurred"` hands both gates back to core, which also
suppresses on unknown focus — the right default for terminals and multiplexers
that never report focus, where every alert would otherwise fire while the user
is looking straight at it.

**Invariant:** blocking requests (permission, form) alert whoever raised them,
root session or subagent, because either one stops the turn; completion and
failure alert only for the root, because a subagent finishing is a step inside
a turn that announces itself when it ends. User interruption is silent. The
hook sees live stream events only — history is hydrated through the messages
API — so attaching to an old session never replays a burst of sounds.

**Rebase:** one line in `apply` beside the existing `sessionID(event)` call,
one field on `StreamInput`, one key on the `RunTuiConfig` pick, and
construction plus disposal in the lifecycle. The mapping and the alert policy
live in the new file. The lifecycle import is dynamic and gated on
`attention.enabled`: the sound module resolves its assets at import time, so a
static import would turn a missing audio asset into a mini startup failure for
everyone rather than an absent chime for the few who switched it on.

**Drop when:** mini grows a plugin host that `attention-notifications` can
target.

#### 25. Checked-out branch on the mini splash

**Files:** `packages/tui/src/mini/git-branch.ts` (new),
`packages/tui/src/mini/splash.ts`, `packages/tui/src/mini/runtime.lifecycle.ts`

**What:** The mini entry splash gains a branch line directly under the working
directory, aligned with it. Read from the repository's HEAD file rather than by
running git, walking up from the working directory and following a `gitdir:`
pointer so a linked worktree or submodule reports its own branch. A detached
checkout shows an abbreviated sha. Mono spells the marker out (`on main`)
because the branch glyph is outside ASCII.

**Why:** The `git-branch` plugin's slots (`sidebar.footer.leading`,
`home.footer.directory.trailing`) name surfaces mini does not have, and mini
has no plugin host to mount them in. The splash is where mini already answers
"where am I", so the branch belongs beside the directory and costs no
statusline width. Registering a `/branch` *command* was considered and
rejected: a command is a prompt template, so invoking it would cost a model
turn to print something two syscalls away, and mini's shell mode (`!`) already
covers the on-demand case.

**Invariant:** the branch renders only alongside the directory, since it is
positioned relative to that row. The splash is a scrollback snapshot —
immutable terminal history — so this is a one-shot read with no watching: the
line records the branch the session opened on, and a later checkout does not
rewrite history. Reading never throws; a non-repository directory yields no
line rather than an error.

**Rebase:** the reading and labelling live in the new file. In `splash.ts` the
entry branch gains one `push` and a body-row count that replaces the inline
`input.detail ? 2 : 1` height expression — the one hunk that will conflict if
upstream reworks splash layout; re-derive from the invariant. The lifecycle
passes `branch:` at both `entrySplash` call sites (startup and replay reset).

**Drop when:** mini grows a plugin host that the `git-branch` plugin can
target, or upstream puts the branch on the splash itself.

#### 26. Provider subscription usage in mini

**Files:** `packages/tui/src/mini/usage.ts` (new),
`packages/tui/src/mini/provider-usage.ts` (new),
`packages/tui/src/mini/provider-usage.view.tsx` (new),
`packages/tui/src/mini/attention.ts`, `packages/tui/src/mini/runtime.ts`,
`packages/tui/src/mini/runtime.lifecycle.ts`, `packages/tui/src/mini/runtime.queue.ts`,
`packages/tui/src/mini/prompt.shared.ts`, `packages/tui/src/mini/catalog.shared.ts`,
`packages/tui/src/mini/footer.ts`, `packages/tui/src/mini/footer.view.tsx`,
`packages/tui/src/mini/footer.width.ts`, `packages/tui/src/mini/types.ts`

**What:** A compact subscription-usage segment in the mini statusline
(`go 22% 22d`), plus `/usage`, which forces a refresh and writes every provider
and window into scrollback. Mini asks the **existing** provider-usage *server*
plugin over the fork's RPC endpoint (entry 8) — no backend change, credentials
never leave the server. `createTerminalFocus` is factored out of entry 24's
module so focus has one owner.

**Why:** The plugin's TUI half targets `session.prompt.footer.leading` and
`app.bottom`, neither of which mini has, and mini has no plugin host. The
server half needs nothing. Three deliberate departures from the plugin: text
only, because its mini-bars cost five or six columns per provider that mini's
single contended row cannot spare; no config, because auto-detect plus the
built-in window pick covers the case without a schema; and scrollback instead
of a fifteen-second overlay for `/usage`, because scrollback persists, scrolls,
and copies, and mini has no overlay surface anyway.

**Invariant:** polling pauses while the terminal is blurred or after five
minutes without user activity, and the values dim rather than vanish — these
endpoints throttle aggressive polling, so the gates are load-bearing, not
cosmetic. What ends a pause is the user: focus regained or a keystroke, both
delivered by the lifecycle's `onPresence`. Events arriving while blurred are the
agent working, not the user returning, so they must not revive the cadence. The
selected model's provider leads the segment whenever it reports anything, so the
one slot a narrow terminal affords goes to the limit the next turn will spend
against rather than to the highest percentage elsewhere. A provider that lost its
connection stops showing a reading; a transient fetch failure keeps the last
good one. `/usage` is handled locally by the prompt queue and never reaches the
server as a prompt, including when submitted mid-turn, where ordinary prompts
would be admitted to the durable queue.

**Rebase:** the poller, the wire format, and the view live in the new files.
Upstream touches are one or two lines each, the riskiest being the statusline
JSX in `footer.view.tsx` and the new `footerWidthPolicy` flags. `/usage` is
discoverable without touching `footer.command.tsx`: `loadRunCommands` appends a
synthetic `RunCommand`, so the palette's existing `action: "slash"` branch
submits `/usage` and the queue intercepts it the way it already does `/new`.
Note `mini/attention.ts` now carries both entries 24 and 26, and that
`onPresence` reads `renderer.keyInput` directly rather than threading a hook
through the footer, so the composer's key handling is untouched.

**Drop when:** mini grows a plugin host that the `provider-usage` TUI plugin
can target.

#### 27. `/model` in mini

**Files:** `packages/tui/src/mini/footer.prompt.tsx`,
`packages/tui/src/mini/footer.command.tsx`, `packages/tui/src/mini/footer.view.tsx`

**What:** A `/model` builtin in the composer's slash menu that opens mini's
existing model picker, plus the matching alias and keywords on the palette's
"Switch model" entry.

**Why:** The picker was reachable only by pressing ctrl+p and recognising
"Switch model" in the list. The slash menu offered `/editor`, `/settings`,
`/new`, `/compact` and `/exit` but not `/model`, and the palette entry carried
no slash alias, so typing `/model` — the obvious thing to try, and what the
full TUI trains — matched nothing at all.

**Invariant:** `/model` opens a panel locally and is never submitted as a
prompt. That is what separates it from entry 26's `/usage`, which *is* a
synthetic command the prompt queue intercepts. Shell mode is excluded, as it
already is for `/settings`, so `!` then `/model` types the text.

**Rebase:** additive throughout — one member on the `SlashOption` action union,
one entry in each of the two menus, one branch in the prompt's `select`, and
`openModel` threaded into `createPromptState` exactly as `onSkillMenu` already
is. Nothing upstream is replaced, so this merges quietly. `"model"` joins the
slash menu's builtin name list, which shadows a project command of that name
the same way `editor`, `new` and `settings` already do; the palette needs no
such guard, since upstream now drops project commands from it wholesale.

**Drop when:** upstream adds a model entry to mini's slash builtins.

#### 28. Mini remembers the selected model

**Files:** `packages/tui/src/model-preference.ts`,
`packages/tui/src/context/local.tsx`, `packages/cli/src/mini-host.ts`,
`packages/tui/src/mini/types.ts`, `packages/tui/src/mini/runtime.ts`

**What:** Mini reads and writes the `recent` half of the `model.json` it
already shares with the full TUI: the picker's choice is saved, and boot adopts
the most recent remembered model.

**Why:** Mini's host wires up only the *variant* half of that file, so a
variant chosen in the TUI carries over to mini while a model does not. Mini
fell through to `sdk.model.default()`, which is the configured default if there
is one and otherwise `model.available()[0]` — sorted newest-first — so every
newly released free model hijacked the next launch. Sharing was never the
question: the file, the repository, and half its API were already crossing the
frontend boundary.

**Invariant:** the catalog is *not* consulted before adopting a remembered
model. `model.list` is documented as a snapshot that may precede plugin
settlement, so a model missing from it is no evidence the model is gone, and
filtering against it would silently discard a remembered model on slow starts.
Session execution owns the authoritative error for one that genuinely no longer
exists — the cost being that a removed provider surfaces at the first prompt
rather than falling back quietly. The variant resolves for the *remembered*
model rather than for `ctx.model`, or it inherits the variant of a model nobody
asked for. Precedence is otherwise unchanged — `--model` and a resumed
session's model both set `state.model`, which short-circuits ahead of this
branch.

**Rebase:** the only non-additive hunk is the `recentModels` move from
`context/local.tsx` into `model-preference.ts`, needed because the CLI host
cannot import a TUI context file; re-derive it from the invariant if upstream
reworks either. In `runtime.ts` the no-model branch of `loadCurrentModel` gains
the `resolveModels` lookup and the variant lookup that follows it, which is the
hunk that will conflict if upstream touches that branch. This is the fork's
only entry spanning `packages/cli` and non-mini TUI code.

**Drop when:** upstream gives mini the same `recent` fallback the full TUI has.

#### 29. A restored variant survives a filling catalog

**Files:** `packages/tui/src/mini/runtime.ts`

**What:** the non-boot branch of `applyModelInfo` requires a non-empty
`state.variants` before treating the list as evidence that the active variant is
no longer offered.

**Why:** `applyModelInfo` read that list two contradictory ways. The boot path
goes through `resolveVariant`/`fitVariant`, which treats an empty list as *not
published yet* and keeps the value. Every later pass took the opposite reading:
an empty list trivially satisfies `!variants.includes(current)`, so the variant
was discarded as retired. Nothing surfaced this while variants only ever came
from `--model` or a resumed session, whose catalog entry is normally present by
then. Entry 28 hits it every launch — the remembered model resolves before its
provider publishes variants, so the first catalog refresh wipes the variant boot
had *just* restored, and mini always starts on the default.

**Invariant:** an empty variant list means unknown, never none. Both readings of
`state.variants` now agree on that, which is the property to preserve if either
branch is touched.

**Rebase:** one condition in one expression, inside upstream logic rather than a
fork-only block — so a rebase can carry it silently while upstream reshapes the
ternary around it. `packages/tui/test/mini/runtime.test.ts` pins the behavior
with a refresh arriving before variants are published; that test failing is the
signal the fix was lost.

**Drop when:** upstream makes the two readings agree, in either direction.

## Fork tooling

Not a seam and not a fix — a fork-local file that upstream does not have and
that changes no upstream behavior.

#### 21. `build-custom.sh` — versioned local builds

**Files:** `build-custom.sh` (new, repo root)

**What:** A wrapper around `packages/cli/script/build.ts` that exports
`OPENCODE_VERSION` and `OPENCODE_CHANNEL` before delegating, so a locally built
binary reports a meaningful version — e.g. `1.18.3+custom.207fd68`. The version
is the in-tree `packages/opencode/package.json` version plus the short commit,
suffixed `.dirty` when the tree has uncommitted changes. Builds a single target
for the current platform by default (`--single` is injected when absent);
`--install` is consumed by the wrapper and stages the binary to
`~/.local/bin/opencode2` via copy-then-rename, so replacing a running `opencode2`
cannot fail with `ETXTBSY`. Every other argument is forwarded to `build.ts`.

**Why:** `Script.version` returns `$OPENCODE_VERSION` verbatim when set;
without it a non-`latest` channel reports `0.0.0-<channel>-<buildnumber>`.
`OPENCODE_CHANNEL` is pinned to `custom` so `Script.channel` does not infer
`latest` from a non-`0.0.0-` version — inferring `latest` would switch the
sqlite database to `opencode.db` and turn on release-channel behavior. Reading
the base version out of the in-tree package.json means the script tracks
upstream version bumps across rebases with no edits.

**Invariant:** produces a versioned build **without editing any upstream
source** — version and channel travel in the environment, and the base version
is read from the in-tree package.json rather than hardcoded.

**Rebase:** a new root-level file with no upstream surface; it cannot conflict.
It does depend on `build.ts` keeping its path and on `Script.version` /
`Script.channel` keeping their env-var behavior — if a build starts reporting
`0.0.0-custom-*`, check those two first. `opencode2` is upstream's own binary
name (`packages/cli/package.json`), not a fork rename; the install step falls
back to any built `bin/*` if that name changes.

**Drop when:** upstream supports a custom version/channel for local builds
directly.

## Commit layout

One commit per entry, or per tight group of entries, with the entry numbers in
the subject (`fork(7): …`, `fork(mounts): …`). `git log --oneline` is therefore a
map of this document, and retiring an entry is `git rebase --onto` past its
commit rather than surgery inside a monolith.

```
fork(mounts)   1, 2, 3, 5, 6, 9, 10, 18, 19, 20   additive; never conflicts
fork(7)        7                                  after mounts (needs 5)
fork(12,13)    12, 13
fork(8)        8
fork(4)        4                                  after mounts (needs 10's terms)
fork(11)       11        ┐
fork(17)       17        │ each carries a "Drop when", so they sit
fork(14)       14        │ nearest the tip where --onto can lift them
fork(15)       15        │ out without disturbing anything below
fork(16)       16        ┘
fork(22)       22                                 new file + additive call sites
fork(23)       23                                 new file + additive call sites
fork(24)       24                                 new file + additive call sites
fork(25)       25                                 new file + additive call sites
fork(26)       26                                 after 24 (extends its focus)
fork(27)       27                                 additive menu entries
fork(28)       28                                 packages/cli + shared TUI code
fork(29)       29                                 after 28 (fixes what it exposes)
fork(21)       21
fork(docs)     FORK.md                            amended, not rewritten
```

Two orderings are load-bearing rather than stylistic: **7 after the mounts
batch**, because it extends the `context/terminal.tsx` provider that entry 5
creates; and **4 after the mounts batch**, because entries 4 and 10 both put
terms on the same two `<Match>` conditions in the session route, so entry 4's
commit has to introduce those lines already carrying `!promptHidden()`.

Keep this order stable. `rerere` keys resolutions to conflict content, which
depends on what has already been applied, so reshuffling commits between rebases
misses the cache and you re-resolve by hand.

Conflict risk tracks *kind*, not file heat. Entries that add a term to an
upstream condition while keeping its expression verbatim merge silently even in
the hottest files; entries that replace upstream logic (7, 12, 13) conflict every
time. That is why the split isolates the latter and batches the former.

Entry 29 is the case neither half covers: it edits a condition inside upstream's
own expression, so it is quiet like the former but silent like the latter when
it is lost. Its test is the only thing that catches that.

## Rebase playbook

### Hot files, by number of entries touching them

Read these first — they carry the most diff and will conflict soonest.

| File | Entries |
| --- | --- |
| `packages/tui/src/component/prompt/index.tsx` | 1, 2, 4, 12, 13, 16, 18 |
| `packages/tui/src/routes/session/index.tsx` | 3, 4, 9, 10, 15, 18 |
| `packages/tui/src/app.tsx` | 5, 6, 7 (provider mount), 10 |
| `packages/tui/src/context/terminal.tsx` (new) | 5, 6, 7 |
| `packages/tui/src/plugin/context.tsx` | 5, 6, 7, 11 |
| `packages/tui/src/routes/session/sidebar.tsx` | 9, 19 |
| `packages/tui/src/util/selection.ts` | 7, 17 |
| `packages/tui/src/mini/runtime.lifecycle.ts` | 22, 24, 25, 26 |
| `packages/tui/src/mini/runtime.ts` | 22, 24, 26, 28, 29 |
| `packages/tui/src/mini/footer.view.tsx` | 22, 23, 26, 27 |
| `packages/tui/src/mini/footer.ts` | 22, 23, 26 |
| `packages/tui/src/mini/attention.ts` (new) | 24, 26 |
| `packages/tui/src/mini/types.ts` | 23, 26, 28 |

Everything else is a single-entry file or an entirely new one. The `mini/*`
rows are additive one- and two-line call sites rather than replaced logic, so
they merge in the quiet way described below — with entry 29 the exception, a
condition edited inside upstream's own expression.

### Known upstream collisions

- Upstream has since grown its own session-route slots: `session.header` (top of
  the session view) and `session.composer.top` (directly above the Composer).
  Neither overlaps this fork's names, but `session.composer.top` is mounted on
  the line immediately above the Composer `open` prop that item 4 edits, and
  upstream's `PluginSlot` import in the session route duplicates the one item 4
  adds — expect adjacent-line conflicts or a duplicate-import auto-merge there.
- `packages/client/src/**` is generated. After rebasing item 8, rerun
  `bun run generate` in `packages/client` rather than resolving conflicts by
  hand.
- **Theme token reads will not conflict, but they do break.** Items 4, 13, 18,
  19, and 20 expose theme tokens to plugins through slot-input getters whose
  bodies read `themeV2`. Core owns that token shape and has changed it before
  (callables like `themeV2.text.subdued()` became plain getters
  `themeV2.text.subdued`, and `hue.accent(500)` became `hue.accent[500]`). Those
  reads sit in fork-only blocks, so a rebase applies them silently and only the
  typecheck catches it — after any rebase, grep for `themeV2.<token>(` in
  `packages/tui/src` and compare against
  `packages/tui/src/theme/v2/component.ts`. The *plugin-facing* contract is
  unaffected: consumers see a getter returning a color either way, so a token
  reshuffle never requires plugin changes.

### Tests carrying the new surface

- Plugin-context fixtures: `packages/core/test/plugin/host.ts`,
  `packages/core/test/plugin/fixture.ts`, and the RPC lifecycle test in
  `packages/core/test/plugin.test.ts`.
- TUI: `packages/tui/test/util/selection.test.ts` and
  `packages/tui/test/util/session.test.ts` (items 7 and 13), plus item 17's
  `selection-text.test.ts` and `selection-text.render.test.ts`.
- Mini: `packages/tui/test/mini/runtime.test.ts` carries items 28 and 29 —
  remembered-model precedence, and the variant surviving a refresh that lands
  before the catalog publishes variants.

## Verification

What to run after a rebase, and what passing looks like. Counts and shas are
deliberately not recorded — upstream changes both constantly, so a stale number
reads as a regression that isn't one.

| Suite | Command | Expected |
| --- | --- | --- |
| Typecheck | `bun turbo typecheck --concurrency=1` | every package successful |
| TUI | `bun test` in `packages/tui` | 0 fail |
| Core plugin | `bun test test/plugin.test.ts` in `packages/core` | 0 fail |
| Server | `bun test` in `packages/server` | 0 fail |
| Lint | `bunx oxlint packages/tui/src packages/core/src/plugin` | 0 errors (warnings expected) |

Run `bun install` first after a rebase — upstream adds workspace packages (most
recently `@opencode-ai/util`), and a stale `node_modules` reports the resulting
unresolved imports as dozens of unrelated Effect type errors across `core`.

The TUI suite includes app-lifecycle tests rendering the new provider stack, the
RPC register → call → dispose-on-unload test in the core plugin suite, and items
17's two guards (`test/util/selection-text.test.ts` and
`test/util/selection-text.render.test.ts`).

Known noise, all pre-existing and unrelated to fork changes:

- The TUI suite is **intermittent**: across six full runs (five before this
  rebase, one after) exactly one reported a single failure that never
  reproduced. Re-run before treating a lone TUI failure as a regression.
- `bun turbo typecheck` segfaults intermittently at `--concurrency=3` on WSL2.
  `--concurrency=1` completes reliably; the failure is in turbo itself, not in
  any package's typecheck.
- `packages/opencode/test/cli/cmd/tui/attention.test.ts` has 4 environment
  (audio) failures, identical on a clean upstream checkout.
- The item-17 render test carries one `no-unsafe-type-assertion` oxlint warning
  for reaching the render context off the root renderable, matching how the
  existing `test/mini/scrollback.surface.test.ts` reaches internals.

A plugin-less build has no behavior differences from upstream:
`packages/tui/src/routes/session/composer/index.tsx` is byte-identical to
upstream, and every gate in items 4, 9, and 10 is inert without a registration.
