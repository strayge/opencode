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
Sanity check it by size — against the correct base the fork is roughly 100 files
and 8k insertions. If a diff reports hundreds of files, the base is wrong, not
the fork.

Entries are grouped by the surface they touch. **Item numbers are permanent
IDs, not an ordering** — they were assigned in the order the changes landed and
never change, so a number stays valid in commit messages and cross-references
even as entries are regrouped. Gaps in the sequence are expected: a retired entry
leaves its number behind rather than freeing it for reuse, so a number never
means two different things. Not every entry is a seam — the ones that are plain
upstream bug fixes, the ones targeting `mini`, and the one that is fork-local
tooling each live in their own section below.

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
| 19 | `sidebar.footer.leading` | slot mount | *none yet* |
| 10 | `app.bottom` + `session.prompt.hidden` / `app.bottom.hidden` | slot mount + gates | focus-mode |
| 5 | `context.terminal` focus API | context API | attention-notifications, terminal-status, provider-usage |
| 6 | `attention.soundboard` + terminal-title decorations | context API | attention-notifications, terminal-status |
| 7 | Clipboard/selection + alternate-copy transforms | context API | markdown-copy |
| 8 | Plugin RPC endpoint | backend seam | provider-usage |
| 12 | `prompt.location` / `prompt.palette` | config option | *`cli.json` only* |

Every fork slot name is declared in the `SlotMap` in
`packages/plugin/src/tui/context.ts`; see [the typed slot
registry](#the-typed-slot-registry).

Upstream fixes:

- [15 — turn wall-clock duration](#15-turn-wall-clock-duration-in-the-assistant-footer)
- [16 — catalog-aware session restore](#16-session-agentmodel-restore-waits-for-the-catalog)
- [17 — selection copy blank rows](#17-selection-copy-preserves-blank-layout-rows)
- [33 — unsending a queued prompt](#33-unsending-a-queued-prompt-before-the-model-sees-it)
- [34 — audio device opened once](#34-a-failed-audio-device-is-opened-once-not-once-per-sound)
- [35 — directory plugin entrypoints](#35-a-directory-plugins-entrypoint-resolves-to-a-real-file)
- [22 — steering a subagent from mini](#22-steering-a-running-subagent-from-the-mini-inspector)
- [23 — prompt-cache staleness in mini](#23-prompt-cache-staleness-in-the-mini-statusline)
- [24 — attention alerts in mini](#24-attention-alerts-in-mini)
- [25 — branch on the mini splash](#25-checked-out-branch-on-the-mini-splash)
- [26 — provider usage in mini](#26-provider-subscription-usage-in-mini)
- [27 — `/model` in mini](#27-model-in-mini)
- [28 — remembered model in mini](#28-mini-remembers-the-selected-model)
- [29 — variant survives a filling catalog](#29-a-restored-variant-survives-a-filling-catalog)
- [30 — named themes in mini](#30-named-themes-in-mini)
- [31 — the other 33 grammars in mini](#31-syntax-highlighting-for-the-other-33-languages-in-mini)
- [32 — unhighlightable code blocks](#32-marking-code-blocks-mini-cannot-highlight)

Fork tooling:

- [21 — `build-custom.sh`](#21-build-customsh-versioned-local-builds)

## The typed slot registry

Slot names are typed. `UI.slot` and `PluginSlot` are both generic over a
`SlotMap` interface (`packages/plugin/src/tui/context.ts`), so a name that is
not a key of that map does not compile, and each name's input object is checked
at the mount and at the plugin's `context.ui.slot` call.

Two consequences for this fork, both structural rather than per-entry:

- **Every fork slot is an entry in `SlotMap`.** That block is the single largest
  contiguous fork edit outside a new file, and it is where a rebase should look
  first if a slot stops resolving. The inputs there are the same objects the
  entries below document, so the map and the entries have to be changed
  together.
- **Every `PluginSlot` mount passes `input` and `mode`.** `mode` is `"all"`
  (render every registration, the old behavior, what all fork mounts use) or
  `"replace"` (last registration wins). A missing `mode` is a type error, so
  this cannot be silently lost.

Upstream also pruned its own slot vocabulary, and `app.bottom` went with it —
so that slot is now the fork's (item 10) rather than something item 10 merely
gates.

The theme tokens several slots hand out are typed as a shared `SlotTheme`
(`text`, `textSubdued`, `accent`); slots wanting more than those three
(items 4 and 13) spell their shape out inline.

`context.theme` is typed as `ResolvedTheme`, supplied from
`themes.currentTokens()`. That extends the same protection one hop further back:
the mounts that read tokens *off the plugin context* to build a slot input
(item 13) are checked where they read, not only where the result lands in a
`SlotMap` entry. A token this fork hands to a slot cannot quietly become
`undefined` because upstream moved it.

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

The row's right-hand content — the subagent/shell counts, the context and cost
reading, and the agents/commands hints — lives in a built-in feature plugin,
`packages/tui/src/feature-plugins/prompt/footer.tsx`, mounted on upstream's own
`prompt.footer.end` slot with `mode="replace"`. The Prompt owns the row itself
and the location label; everything past them is that plugin's.

That split the fork's prompt-row entries in two. Items 1 and 18 live in the
Prompt, because they bracket the whole row. Items 12 (`prompt.palette`) and 13
live in the feature plugin, because the content they modify does. That
is also why `PromptFooter` reaches for `useConfigOptional()` and
`useOptionalPlugin()` rather than the throwing variants: upstream renders it
directly in `test/feature-plugins/prompt-footer.test.tsx` with no provider tree,
and the optional reads let both entries degrade to upstream behavior there
instead of crashing an upstream test.

A built-in feature plugin importing the plugin context also introduced an import
cycle — `plugin/context.tsx` imports `plugin/builtins.ts`, which imports the
feature plugin back. Evaluating the builtins array eagerly then reads a
still-uninitialized export whenever the feature plugin is the entry point (a
test importing it directly). `builtins` is therefore a function rather than an
array, which defers the dereference past module evaluation. That is a two-line
fork edit in `plugin/builtins.ts` plus its one call site; upstream adding a
built-in merges cleanly through it.

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
component. Conflicts, if any, are trivial. The input object is declared after the
Prompt's `store`, because its getters read `store.mode` and the theme tokens;
upstream moves those declarations around, so re-anchor on them rather than on a
line position.

#### 18. `session.prompt.footer.trailing` slot

**Files:** `packages/tui/src/component/prompt/index.tsx`,
`packages/tui/src/routes/session/index.tsx`

**What:** A V2 `PluginSlot` mounted at the *end* of the Prompt's bottom row,
past upstream's `prompt.footer.end` mount and so past the agents/commands hints
that plugin draws — the mirror of item 1, which mounts at that row's start. Slot
input is a stable object with reactive getters:
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
hints — which now means after the `prompt.footer.end` mount, not after inline
JSX. Anchor on that slot, since the hints themselves are no longer in this file.

**Rebase:** same shape as item 1, plus a `sidebar` prop passed from the session
route's `Prompt` element. That element no longer carries a `right=` prop
(upstream dropped it along with the legacy `session_prompt_right` runtime), so
`sidebar` is the only fork prop there.

#### 2. `session.prompt.right` slot

**Files:** `packages/tui/src/component/prompt/index.tsx`

**What:** A V2 `PluginSlot` rendered in the Prompt's `right` cluster (the
TPS/AVG/TTFT area), next to the `props.right` render, with `{ sessionID? }`
input. Mounted inside the `Prompt` component, not in the session route.

**Why:** Nothing upstream exposes this position any more. It was the legacy
`session_prompt_right` slot, and that runtime is gone along with every legacy
mount, so the position exists *only* through this entry.

**Invariant:** exposes the `right` cluster position through the V2 registry.

**Rebase:** trivial mount inside the `Prompt` component. `PromptProps.right`
survives upstream but no route passes it, so the cluster is empty without a
plugin.

**Note:** no plugin in the suite registers this slot. It is the cheapest entry
to drop if the fork is ever trimmed to what is actually consumed — more so given
nothing upstream renders beside it.

#### 13. `session.prompt.context` replacement slot

**Files:** `packages/tui/src/feature-plugins/prompt/footer.tsx`,
`packages/tui/src/util/session.ts`, `packages/tui/src/config/index.tsx`,
`packages/tui/src/plugin/context.tsx`

**What:** An inline V2 `PluginSlot` mounted in place of the built-in prompt
context value (`9.0K (1%)`). When no plugin registers the slot, the built-in
span renders unchanged. Slot input is a stable object with reactive getters:
`{ sessionID?, tokens?, percent?, text?, cost?, updatedAt?, theme }`; `theme`
exposes `textSubdued` and `error`. Core continues to own the surrounding
live-work status, separators, truncation, and empty-state behavior.

The reading and its cost are joined by core into one string, so the slot covers
both — hence `cost` in the input rather than a cost span core keeps drawing
beside a replaced context span.

**Why:** Context presentation policy can depend on information outside core,
such as provider-specific cache assumptions. A replacement seam lets a plugin
style or annotate the existing value without duplicating the complete status
cluster or embedding that policy in the fork. `updatedAt` is the creation time
of the assistant message supplying the displayed usage.

**Invariant:** the slot replaces only the context/cost reading; the live-work
counts, the separators around them, and the hint fallback when the reading is
empty stay core's, so plugins own the reading and not the complete status
cluster.

**Rebase:** this now lives in the built-in prompt-footer plugin rather than the
Prompt (see [the prompt-row note](#prompt-row)). Upstream's `status()` memo there
returns a filtered array joined with `" · "`; the fork splits it into a `usage()`
memo carrying the raw `contextUsage` result plus its formatted halves, so the
slot input has `tokens`/`percent`/`updatedAt` to hand out. Preserve that split —
re-collapsing it to the joined array silently drops the numeric fields while
still compiling, since they are all optional. The `updatedAt` field on
`contextUsage` (in `util/session.ts`) is a one-line addition guarded by
`test/util/session.test.ts`.

`updatedAt` reads `last.time?.created`, and the optional chain is load-bearing
despite the schema declaring `time`. `contextUsage` is shared code: upstream's
newer `sidebar-context` built-in calls it too, and upstream's test for that
built-in hands it a synthesized assistant message carrying `tokens` but no
`time`. An unguarded read throws there — in an *upstream* test, on a path
upstream itself never touches — so the guard is what keeps this entry from
breaking a component it has nothing to do with. Any future field this entry
adds to the returned object owes the same caution.

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
- The arrow-bound `session.parent` command falls through when the focused
  editor has text — without this it shadows the app-level textarea layer
  (later-registered layers win keymap ties) and steals cursor keys from the
  steering input. It is the only core command needing the guard: it binds `up`,
  while the horizontal arrows carry no core binding and are the plugin's own
  keymap layer to claim.
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
`textSubdued`, and `accent` from the sidebar's own `useTheme("elevated")`
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

**Note:** no plugin in the suite registers this slot. The built-in footer now
renders `directory:branch` itself, which is what a contribution here would most
naturally have added. Like item 2, this is a cheap entry to drop if the fork is
trimmed to what is actually consumed.

### Session-wide gates

#### 10. `app.bottom` slot + `session.prompt.hidden` / `app.bottom.hidden` gates + focus (read-only) mode

**Files:** `packages/tui/src/routes/session/index.tsx`,
`packages/tui/src/app.tsx`

**What:** The `app.bottom` slot, plus two presence-only V2 slot gates following
the pattern of items 4 and 9.

- `app.bottom` itself: a full-width row mounted below every route in `app.tsx`,
  above upstream's own `app` slot. The name is the fork's — upstream has no
  `app.bottom` — so this entry owns both the mount and the gate. One plugin uses
  it:
  `provider-usage` mounts its `/usage` output there — a status line while
  refreshing, then the per-window detail table, cleared after fifteen seconds.
  Its persistent usage bars are *not* here; those are item 1's slot, inside the
  Prompt.

  It is fair to ask why this cannot just be upstream's `app` slot, given the two
  render adjacently in the same column. Because `app` is what every plugin
  needing a live reactive owner registers into — five plugins in the suite plus
  three upstream feature plugins host their keymap registrations there, rendering
  nothing. Gating `app` the way `app.bottom.hidden` gates `app.bottom` would
  unmount all of them and take their keybindings with it. The gateable visible
  region has to be a different slot from the always-mounted owner host.
- `promptHidden = plugins.slot("session.prompt.hidden").length > 0` (in the
  session route). While at least one active plugin registers this slot, every
  input surface — upstream's `session.composer.top` mount, the Composer, and the
  Prompt — is gated off so the transcript scrollbox reclaims the full height,
  turning the session into a read-only output view. How many surfaces the cluster
  has is upstream's call and has changed before; what this entry owns is that
  *every* one of them is inside the gate. The wrapping `<box flexShrink={0}>` is itself dropped
  while hidden — an empty box would still be a flex child, so the parent's
  `gap={1}` would leave a blank row above the `paddingBottom` one — and
  `paddingBottom` collapses to `0`, leaving exactly one blank row below the
  transcript.
- `appBottomHidden = plugins.slot("app.bottom.hidden").length > 0` (in
  `app.tsx`), wrapping the `app.bottom` mount in `Show when={!appBottomHidden()}`.
  `app.bottom` lives at the App level, above the session route, so a route-scoped
  gate cannot reach it — hence a distinct gate in `app.tsx`. This lets a read-only
  view reclaim the bottom region along with the input cluster; the `focus-mode`
  plugin registers both slots together.

Two deliberate asymmetries, both in the route:

- **Required input still shows.** The permission and form `<Match>` branches
  carry no `promptHidden` term, so a pending permission or form prompt renders
  through the existing `<Switch>` even in focus mode; only the Composer (behind
  `Show when={!promptHidden()}`) and the plain Prompt `<Match>` (gated
  `!promptHidden() && !disabled()`) drop out. The wrapper itself is kept while
  `disabled()`, which is what lets those branches render at all. Focus mode never
  swallows a prompt the user has to answer.
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

**Rebase:** the gate is a `Show when={!promptHidden() || disabled()}` around the
input cluster's `<box flexShrink={0}>`, a `Show when={!promptHidden()}` around the
Composer, a leading `!promptHidden() &&` on the `<Switch>`'s first `<Match>`, and
a `!promptHidden() &&` on the last `<Match when={!disabled()}>` — upstream
expressions kept verbatim after the added term, so they re-anchor cleanly. The
`promptHidden` memo and the sidebar-coupling effect are purely additive. In
`app.tsx` it is one `createMemo` plus the `Show`-wrapped `app.bottom` mount,
which the fork now owns outright.

### Plugin context

Items 5, 6, and 7 center on one new provider file
(`packages/tui/src/context/terminal.tsx`) mounted around `PluginProvider`, plus
new fields on the V2 plugin context type
(`packages/plugin/src/tui/context.ts`, `packages/tui/src/plugin/api.tsx`).

**The context literal lives in `plugin/api.tsx`, not `plugin/context.tsx`.**
`api.tsx` owns both `usePluginHost()` — one object collecting every host hook,
since hooks must run during component setup — and `createPluginContext()`, which
adapts them into the object a plugin receives. `plugin/context.tsx` keeps only
the provider, the registration store, and the reconcile/hot-reload lifecycle.
Every fork field these three entries add (`terminal`, `clipboard`, the
`attention` wrapper) therefore lives in `api.tsx`, reached as `host.<service>`
with disposal pushed onto `input.owned` rather than a closure-scoped `owned`.
Adding a hook means two edits: the `usePluginHost` literal and the context
literal.

`PluginRoute` and `PluginSlot` live in `plugin/render.tsx`. Every fork mount
imports the component from there and the hooks from `plugin/context`, which is
why several files import from both.

Note where the plugin package's paths sit: the V2 API is `packages/plugin/src/**`
and V1 is `packages/plugin/src/v1/**`. The import that catches this is
`@opencode-ai/plugin/tui`, which resolves to the *V2* TUI module — V1's types
(`TuiAttention*`, `TuiThemeCurrent`) live at `@opencode-ai/plugin/v1/tui`. Fork
files reaching for a V1 type through the V2 specifier fail to compile rather than
resolving to something plausible, which is the good case; the bad case would have
been a name that exists in both.

#### 5. `context.terminal` focus API (V2 TUI plugins)

**Files:** `packages/tui/src/context/terminal.tsx` (new),
`packages/tui/src/plugin/api.tsx`, `packages/plugin/src/tui/context.ts`,
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

**Rebase:** additive — a new provider file plus context-type fields. The
provider *mount* is the exception: `app.tsx`'s stack keeps growing (most
recently `StorageProvider` and `TuiStartupProvider` above it), and because each
new wrapper reindents everything below, the conflict presents as the whole
nesting block rather than one line. Resolve it by taking upstream's tree whole
and reinserting `<TerminalProvider>` at its one correct depth, then run prettier
on the file — reading the two sides line by line is wasted effort when the only
fork content is a single wrapper.

#### 6. `attention.soundboard` + terminal-title decorations

**Files:** same as item 5

**What:** Two APIs, one on the plugin context type and one on the
`TerminalProvider` wiring:

- `context.attention.soundboard`. **Upstream owns the attention host** —
  `packages/tui/src/context/attention.tsx` instantiates `createTuiAttention`, and
  `context.attention.notify` is upstream's — so all this entry adds is the
  sound-pack registry, which upstream's `Attention` interface omits even though
  the object behind it has one. The fork widens that interface with `soundboard`
  and wraps the host in `plugin/api.tsx` rather than passing it through, so a
  registered pack is unregistered when the owning plugin unloads. `attention-notifications` calls
  `context.attention.soundboard.activate(...)`, so dropping it would break that
  plugin. Note: `attention.enabled` defaults to `false` upstream, so sounds
  require opting in via `cli.json`.
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

**Why:** Upstream gives plugins notifications but no safe way to touch the
terminal title. Raw `renderer.setTerminalTitle()` writes from plugins would race
the app's own reactive title effect; the decoration registry removes that race by
construction. (The sound side is nearly upstream's now — see the soundboard note
above for the sliver this entry still carries.)

**Invariant:** `app.tsx`'s title effect stays **byte-for-byte upstream** —
decorations are applied by wrapping `setTerminalTitle` inside `TerminalProvider`,
not by rewriting the app's title effect into `base + compose()`. That is what
keeps this hot file free of a title-decoration diff.

**Rebase:** the title half is additive, in the same provider file as item 5.
`TerminalProvider` must **not** construct its own `createTuiAttention` — upstream's
`AttentionProvider` already mounts one, and a second host would mean two focus
gates and two sound pipelines off the same config. `TerminalProvider` therefore
nests inside `AttentionProvider` in `app.tsx` and carries no attention of its own.

**Drop when:** upstream puts `soundboard` on its own `Attention` interface, at
which point only the title decorations remain and this entry merges into item 5.

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
`packages/core/src/location-services.ts`, `packages/plugin/src/{effect,promise}/rpc.ts`,
and regenerated `packages/client/src/**`

**What:** A generic request channel from any OpenCode client to server
plugins:

- `PluginRpc` registry service (`packages/core/src/plugin/rpc.ts`): flat
  method namespace per Location; registrations are scoped, so unloading the
  owning plugin removes its handlers; duplicate registration is a defect.
- Server-plugin context gains `context.rpc.register(method, handler)` and
  `context.rpc.call(method, payload)` in both the effect and promise APIs
  (`packages/plugin/src/{effect,promise}/rpc.ts`, host wiring in
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

### Config

#### 12. `prompt.location` / `prompt.palette` config options

**Files:** `packages/tui/src/config/index.tsx`,
`packages/tui/src/component/prompt/index.tsx`,
`packages/tui/src/feature-plugins/prompt/footer.tsx`

**What:** Two new optional booleans in the TUI config's `prompt` section,
set in `cli.json`. `prompt.location: false` suppresses the working-directory
label that the Prompt renders in its footer row while the session is idle
(`locationLabel`). `prompt.palette: false` suppresses the command palette
shortcut hint (`ctrl+p commands`) in the same row's right cluster (normal mode
only; the shell-mode `esc exit shell mode` hint is unaffected). Unset or `true`
keeps upstream behavior for each.

The two halves no longer live in the same file: the label is still the Prompt's,
but the hint moved into the built-in prompt-footer plugin (see [the prompt-row
note](#prompt-row)).

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
schema, an early-return line at the top of the `locationLabel` memo, and a term
on the `<Show>` around the palette-hint `<text>` in the feature plugin's
normal-mode branch. That `<Show>` is upstream's, carrying a narrow-terminal gate
(`dimensions().width >= 44`); the fork contributes
`&& config?.data.prompt?.palette !== false` rather than the whole element. Keep
both terms: dropping upstream's re-shows the hint on narrow terminals, dropping
the fork's makes the config option dead.

The `?.` is load-bearing: that component reads config through
`useConfigOptional()` so it still renders in upstream's provider-less test, and
an absent provider has to mean "upstream behavior", not "hidden". **Both optional
hooks are the fork's own** — `useConfigOptional` in `config/index.tsx` beside
`useConfig`, and `useOptionalPlugin` in `plugin/context.tsx` — four lines each.
If either goes missing the failure is a compile error in the built-in prompt
footer, not a behavior change.

## Upstream fixes

These are not extension seams — they are plain fixes carried on top of upstream,
and each should be dropped the moment upstream fixes it. No plugin consumes any
of them.

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

#### 33. Unsending a queued prompt before the model sees it

**Files:** `packages/schema/src/session-event.ts`,
`packages/core/src/session/{pending,projector,message-updater}.ts`,
`packages/core/src/session.ts`, `packages/protocol/src/groups/session.ts`,
`packages/server/src/handlers/session.ts`, regenerated
`packages/client/src/**`, `packages/tui/src/routes/session/unqueue.ts` (new),
`packages/tui/src/routes/session/{index,dialog-message}.tsx`,
`packages/tui/src/context/data.tsx`, `packages/tui/src/config/v1/keybind.ts`

**What:** A third terminal outcome for admitted input. `session.input.revoked`
joins `admitted` and `promoted`; `SessionPending.revoke` publishes it and
`projectRevoked` deletes the row *without* projecting a message, so a revoked
input leaves no trace in history. Reached over
`DELETE /api/session/:sessionID/pending/:inputID`, which answers 200 with the
dropped record or 409 when the input is no longer pending.

Two TUI surfaces consume it: an **Unsend** action leading a queued message's
dialog, and `session.unqueue` (slash `/unqueue`) popping the newest queued
input, repeatable to walk backwards. Both restore the text, files, and agent
mentions to the input box through `projectedPromptInput`, the same call
`Revert` already makes. The keybind is registered as `"none"` — bindable
without claiming a chord upstream may want.

The message row's `<Show>` in `SessionRowView` is now **keyed**. This is part
of the entry rather than a separate fix: the hazard is latent upstream, since
nothing there removes a message that is currently rendered as a row — revert
commit only drops messages past a boundary the rows already exclude, and
promotion keeps the message it moves. Revocation is the first removal of a
*rendered* message, and unkeyed the child's memos re-run through an
invalidated accessor and throw `Stale read from <Show>`.

**Why:** A prompt typed during a running turn goes out immediately as `steer`
delivery, so the input box clears and the message is durable before the user
can reconsider; the only prior way to take it back was `/undo` to an earlier
message, which discards real history and file changes. Keeping `steer` (rather
than holding prompts TUI-locally until the turn ends, which would make
cancellation free) is deliberate: mid-turn insertion is the reason the message
goes out immediately, and that is worth more than an easy cancel.

**Invariant:** revoke runs under the same inbox lock `promote` holds, so an
input is either revoked whole or promoted whole and never observed as both.
Losing that race is an expected outcome, not an error — core resolves to
`undefined` and only the HTTP layer renders it as 409 — and the TUI never
removes a row optimistically, so a lost race cannot leave the transcript
disagreeing with the server.

**Limitation:** `unqueue` revokes exactly the input it is given. A prompt
submitted with a pending editor selection admits a synthetic input beside the
user one, and that synthetic is left pending, later promoted alone as a bare
file selection. Inferring which neighbouring synthetics belong to a prompt
would silently eat unrelated ones — a backgrounded-work notice, a plugin's —
so the precise fix is to capture both ids at submit time and thread the pairing
to the route.

**Rebase:** the core and protocol edits are additive and sit beside their
`promoted`/`admitted` siblings, so they re-anchor cleanly; adding the event to
`Event.inventory` is a typed breaking change that surfaces any missing
exhaustive arm at compile time rather than at runtime. **Rerun `bun run
generate` in `packages/client` instead of resolving conflicts in
`packages/client/src/**`.** The riskiest hunk is the keyed `<Show>`, the only
place this entry edits existing upstream rendering; if upstream restructures
`SessionRowView`, re-derive from the invariant above rather than replaying the
diff. The sibling assistant-footer `<Show>` has the same unkeyed shape and is
deliberately untouched.

Sitting beside those siblings is also what makes this entry's *silent* failure
mode: `revoke` and `projectRevoked` take the same event-bus argument `admit` and
`promote` do, so a rename there (`events` → `bus`, `EventV2` → `Bus`) leaves the
fork's copies referring to a name that no longer exists. It does not conflict —
it fails to compile, which is the cheap version. Whenever this entry's hunks look
untouched after a rebase, check them against the sibling immediately above.

**Drop when:** upstream ships input revocation of its own. The keyed `<Show>`
can go the moment upstream keys it, independently of the rest.

**Note:** mini is untouched. It has no plugin host and sends mid-turn prompts
as `queue` delivery, so its "Pending work" panel (read-only today) is where the
same capability would land — a longer cancel window and almost no race.

#### 34. A failed audio device is opened once, not once per sound

**Files:** `packages/tui/src/audio.ts`

**What:** `play()` remembers that `Audio.start()` failed and stops calling it,
the way `getAudio()` already remembers that `Audio.create()` threw. The flag
clears in `dispose()` beside `audio` and the sound cache.

**Why:** Everything in JS already handles a missing playback device in silence
— `play()` returns null, `attention.ts`'s `playSound` falls through its
candidate list, and `notify` reports `{ ok: false, sound: false }`. The failure
is not silent below JS. Opening the device is native code, and on a host with
no usable card the backend writes its diagnostics straight to fd 2. That path
bypasses the renderer's console capture — the full TUI leaves `consoleMode` at
OpenTUI's `console-overlay` default, which only rebinds the JS `console`
methods — so the lines land on the alternate screen as raw text, and because
the renderer diffs frames, cells it believes are unchanged are never repainted
and the damage stays until a resize. Upstream sets `playbackStarted` only on
success while `play()` calls `start()` whenever `isStarted()` is false, so
every later notification reopened the device and repainted the mess; that is
what turns one burst into a covered screen. Reproduced under a stubbed-out ALSA
config: seven lines per attempt, more against a stock `alsa.conf`. Memoizing
does not suppress the *first* burst — nothing reachable from JS can, short of
redirecting fd 2 around the call, which is a platform-specific hack this file
does not otherwise need.

**Invariant:** the playback device is opened at most once per process. The cost
is that hardware appearing mid-session — headphones plugged in after the first
sound — stays unused until restart. Accepted: the alternative is a burst of
screen damage per notification for a device that is usually still missing.

**Rebase:** one flag and one widened branch in a small file upstream rarely
touches. If `play()` has been restructured, re-derive from the invariant rather
than replaying the diff; the shape matters less than never calling `start()`
twice after a failure.

**Drop when:** upstream memoizes the failed start itself, or OpenTUI silences
the native backend's own writes to fd 2.

#### 35. A directory plugin's entrypoint resolves to a real file

**Files:** `packages/tui/src/plugin/context.tsx`,
`packages/tui/src/plugin/discovery.ts`

**What:** `resolveLocal` probes the filesystem for a directory plugin's
entrypoint — `<dir>/tui.<ext>`, then `<dir>/tui/index.<ext>` — instead of
handing back `import.meta.resolve("<dir>/tui")`. The extension list moves to an
ordered exported `entrypointExtensions` in `discovery.ts` (TypeScript first),
with that file's existing membership `Set` derived from it so discovery is
unchanged. A directory with no TUI half now resolves to `undefined`, which the
caller already reports as `unsupported`.

**Why:** `import.meta.resolve` is a **no-op on an absolute `file://` URL**: it
neither probes extensions nor checks existence, so it returned
`file:///…/plugin/tui` — a specifier only the module loader can resolve, by
probing extensions itself at import time. That was harmless while the result fed
straight into `import()`. Upstream then added plugin hot-reload, which reads the
entrypoint's mtime to cache-bust the ESM cache:

```js
const version = local ? freshSpecifier(entrypoint, (await stat(new URL(entrypoint))).mtimeMs) : entrypoint
```

`stat` does no extension probing, so every directory-style local plugin fails to
load with `ENOENT … statx '…/plugin/tui'` while `import()` on that same
specifier succeeds. Upstream supports the directory form — `localSource` accepts
absolute and `./` paths — but its own discovery only ever yields *files* from
`<config>/plugins/tui/`, so nothing upstream exercises it. Every plugin in this
fork's suite is directory-style, so all of them broke at once.

The failure is per-plugin rather than fatal (`reconcile` records it as `failed`
and the TUI starts without it), which is why it reads as "my plugins vanished"
rather than a crash.

**Invariant:** a resolved local entrypoint is a path, not just a specifier —
anything `resolveLocal` returns can be `stat`ed as well as imported. Preserve
that rather than the probing order, and note the *absence* of an entrypoint must
stay `undefined` (→ `unsupported`), since pointing at a server-only plugin
directory is normal and is not a broken plugin.

**Rebase:** contained to `resolveLocal` plus the extension-list export. The
`export` on `resolveLocal` itself exists only for the test. If upstream reworks
local resolution, check the invariant rather than replaying the diff — and note
the bug is invisible to a suite that only uses file entrypoints, which is why
the guard builds directory fixtures.
`packages/tui/test/plugin-entrypoint.test.ts` is that guard (a new file, no
conflict surface); four of its five cases fail against upstream's version.

**Drop when:** upstream resolves a directory plugin to a real file — or stops
needing the entrypoint as a path, which would mean giving up mtime-based
hot reload.

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
`footer.view.tsx` the JSX swap replaces the statusline's usage text with a
component and moves the mono separator into it. That row is a measured layout
(`footerStatuslinePolicy`) rendering the reading through a `<Show>` render-prop,
so the swap goes inside that, and `activityMeta` stays the raw joined string so
`ContextUsage` can split it. `splitUsage` splits on the `" · "` the
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
everyone rather than an absent chime for the few who switched it on. The sound
names come from the V1 plugin types, so the import is
`@opencode-ai/plugin/v1/tui` — `@opencode-ai/plugin/tui` is the V2 module and
does not carry them (item 30 has the same dependency for `TuiThemeCurrent`).

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

**Why:** The full TUI shows the branch as `directory:branch` in the prompt
location label and the sidebar footer; mini has neither surface, and no plugin
host to mount one in. The splash is where mini already answers "where am I", so
the branch belongs beside the directory and costs no statusline width.
Registering a `/branch` *command* was considered and rejected: a command is a
prompt template, so invoking it would cost a model turn to print something two
syscalls away, and mini's shell mode (`!`) already covers the on-demand case.

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

**Drop when:** upstream puts the branch on the mini splash itself, or gives mini
the location label the full TUI already resolves a branch into.

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

**Invariant:** subscription usage is the *last* section the statusline
allocates, so it is the first to go when the row is tight — the context reading
and the model matter every turn, a quota that resets in days does not. Providers
are budgeted one at a time in the order `usageGroups` ranks them, so a narrow
row keeps only the one worth the columns. Polling pauses while the terminal is
blurred or after five minutes without user activity, and the values dim rather
than vanish — these endpoints throttle aggressive polling, so the gates are
load-bearing, not cosmetic. What ends a pause is the user: focus regained or a keystroke, both
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
JSX in `footer.view.tsx` and the section budget in `footer.width.ts`. That
budget was originally two breakpoint flags on `footerWidthPolicy`; upstream
replaced breakpoints with a measured policy, so the entry now adds
`providerUsageWidths` in / `providerUsageCount` out on `footerStatuslinePolicy`
and measures each group through `usageGroupWidth`. That function mirrors what
`UsageSegment` draws and nothing enforces the correspondence but
`provider-usage.view.test.ts`'s render-vs-measure assertion — under-reporting
pushes the sections after it off the row, so re-check it whenever the segment's
rendering changes. If upstream reworks the policy again, re-derive from the
invariant rather than replaying the diff. `/usage` is
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

#### 30. Named themes in mini

**Files:** `packages/tui/src/mini/theme.named.ts` (new),
`packages/tui/src/mini/theme.ts`, `packages/tui/src/mini/runtime.lifecycle.ts`,
`packages/tui/src/mini/footer.ts`, `packages/tui/src/config/index.tsx`

**What:** a `mini.theme` config option naming a theme from the same registry the
full TUI reads. Unset or `"system"` keeps the palette-derived look; `"inherit"`
follows `theme.name`; any other value resolves that theme, bundled or discovered
from `<config>/themes/*.json`. Mini's two `resolveRunTheme` call sites go through
`resolveMiniTheme` instead, which delegates straight back to `resolveRunTheme`
whenever no named theme is both configured and resolvable.

**Why:** mini derives every color from the terminal's ANSI palette, so the only
way to restyle it was to restyle the terminal — which changes every other
program in that terminal, and still cannot reach the roles the palette does not
carry. `generateSystem` hardcodes `markdownHeading` to the foreground and
computes `textMuted` from background luminance, so headings and muted text are
unreachable from a palette at any setting. The full TUI has honored
`theme.name` for as long as it has existed; mini simply never read it.

**Invariant:** three properties, in order of how quietly they break.

*Named themes are not quantized.* The system path snaps scrollback colors onto
the nearest terminal palette entry (`quantizeTheme`) so mini looks native
anywhere. Running an authored theme through it substitutes the terminal's
approximation for the color the theme asked for — a jade accent becomes whatever
that terminal calls cyan — which looks like a theme that merely renders badly
rather than a bug. The tests assert `intent !== "indexed"` for exactly this.

*The background stays transparent.* Mini writes scrollback into the real
terminal scrollback buffer, where it cannot own a background; `generateSystem`
already returns `alpha(bg, 0)` for that reason. A named theme's background has
its alpha zeroed and its RGB kept, because `map()` recovers the RGB via
`alpha(bg, 1)` for the footer's status shades. Honoring it opaquely paints the
live footer only, seaming against the scrollback above it. The zeroing allocates
a new RGBA rather than mutating: `resolveThemeColors` aliases the background
object into `selectedListItemText` when a theme omits that key.

*Discovery honors `OPENCODE_CONFIG_DIR`.* That variable relocates the whole
config tree, and `Global.Path.config` is compiled in and ignores it — reading
the latter alone finds no themes at all for a relocated install. Note that
`context/theme.tsx` reads `Global.Path.config` directly, so the *full TUI* still
has this bug; mini deliberately does not copy it.

Every failure — absent setting, unknown name, unreadable file, a color reference
`resolveThemeColors` throws on — falls back to the palette-derived theme rather
than surfacing. A theme typo must not stop mini from starting, and the default
path must stay reachable without config changes.

**Limitation:** only version-1 theme documents resolve. Upstream also ships
natively authored v2 themes, and mini reaches colors through the v1 path
(`mini/theme.ts`'s `resolveTheme` reads a `ThemeV1Json`, and `map` wants that
flat shape), so a discovered v2 file is filtered out and falls back rather than
being handed to a resolver that cannot read it. Every bundled theme is still v1,
so this only affects hand-written v2 files. Lifting it means a bridge from
`resolveThemeDocument`'s output to `TuiThemeCurrent`, which is a bigger change
than this entry.

**Rebase:** the diff is shaped to keep the logic out of upstream files. All of it
lives in the new `theme.named.ts`; `mini/theme.ts` gains a single `export`
keyword on `map`, and the two call sites change one line each. Nothing inside
`resolveRunTheme` is touched, which matters because that body is actively
evolving upstream — mono landed inside it. The `config/index.tsx` hunk is one
additive key in the `mini` struct and will collide with upstream additions
there, mechanically. If upstream moves theme resolution, re-derive from the
invariant: mini resolves its theme through `resolveMiniTheme`, and the named
branch neither quantizes nor paints a background.

The directory list comes from `configDirectories` in
`util/config-directories.ts` — upstream's rename of what was `themeDirectories`
in `theme/discovery.ts`, same signature and same "config dir plus every
ancestor's `.opencode`" semantics. This is the third failure mode in the list
above and the quietest: `theme.named.ts` imports it dynamically, so a rename
surfaces only at typecheck, and losing the call entirely would leave named
themes silently falling back to the palette-derived default.

**Drop when:** upstream teaches `resolveRunTheme` to honor a configured theme
name — at which point delete `theme.named.ts` and revert the call sites.

#### 31. Syntax highlighting for the other 33 languages in mini

**Files:** `packages/tui/src/mini/scrollback.surface.ts`

**What:** `addDefaultParsers(parsers.parsers)` at module scope, giving mini the
same grammar set the full TUI has.

**Why:** mini highlighted javascript, typescript and markdown and nothing else —
a ` ```python ` or ` ```bash ` fence rendered as unstyled text, which is most of
what a coding agent prints. The grammars were never missing:
`packages/tui/src/parsers-config.ts` has defined 33 of them all along, and
`routes/session/index.tsx` registers them as an *import side effect*. Mini
mounts neither `app.tsx` nor the session route, so the call never ran and mini
saw only what opentui bundles — javascript, typescript, markdown,
markdown_inline, zig.

**Invariant:** registration must precede tree-sitter client initialization.
`addDefaultParsers` mutates a list the client reads exactly once, when it
initializes, so a call ordered after that point is silently a no-op — the
failure looks like the feature was never added rather than like a bug. Module
scope next to the `getTreeSitterClient()` call is what guarantees the ordering;
moving it into a boot step reintroduces the race.

Note this gives mini a network path it did not have: `parsers-config` sources
wasm and queries from GitHub, cached once under `~/.local/share/opentui`.
Languages the full TUI has already fetched cost nothing.

**Rebase:** two import lines and one statement, all additive, in a file no other
entry's logic touches. If upstream gives mini its own parser registration, drop
this rather than merging both — registering twice is harmless but pointless.

**Drop when:** upstream moves `addDefaultParsers` somewhere mini also reaches.

#### 32. Marking code blocks mini cannot highlight

**Files:** `packages/tui/src/mini/markdown.code.ts` (new),
`packages/tui/src/mini/scrollback.surface.ts`,
`packages/tui/src/mini/scrollback.writer.tsx`,
`packages/tui/src/mini/theme.ts`

**What:** fenced blocks whose language no parser claims render in
`markdownCodeBlock` instead of the entry's text color, through a
`markdownRenderNode` passed at both markdown call sites. It handles `code`
tokens only and defers everything else to the default rendering; mono needs
nothing from it, since upstream now monochromes markdown by transforming the
renderable tree (`monoMarkdownRenderable`) rather than through `renderNode`, so
the two passes compose without being threaded together.

**Why:** with no parser, tree-sitter returns zero highlights and
`MarkdownRenderable`'s `CodeRenderable` falls back to its `fg` — which
`MarkdownRenderable` sets to the surrounding entry's text color. An unlabeled
fence was therefore pixel-identical to the prose around it, with nothing marking
it as code. Entry 31 shrinks the set this applies to but cannot empty it:
unlabeled fences have no language to register.

**Invariant:** the syntax style cannot solve this, which is the thing to
re-derive rather than re-litigate. The markdown grammar *does* scope fences as
`markup.raw.block` — verifiable with `highlightOnce(src, "markdown")` — but
`MarkdownRenderable` substitutes its own `CodeRenderable` for the fence, so that
scope never reaches the rendered block. Recoloring the renderable through
`renderNode` is the only seam.

`hasHighlighting` checks the info string against the filetypes actually
registered, because `infoStringToFiletype` normalizes aliases but returns
unknown strings *unchanged* rather than undefined — `"notalang"` comes back as
`"notalang"`, so its result alone would read as highlightable. `"shell"` and
`"golang"` are correctly excluded: nothing aliases them onto `bash` and `go`.

`markdownCodeBlock` was a dead key before this — every theme sets it, and in the
v1 syntax path only `theme/v2/v1-migrate.ts` read it. `generateSystem` maps it
to the foreground, so the palette-derived default is unchanged and a theme opts
in by setting it to something else.

**Rebase:** the logic is in a new file; the upstream-file diff is two call sites
and four additive lines in `theme.ts` (`RunBlockTheme`, `map`, the fallback, and
the mono theme). The call sites will conflict whenever upstream changes how mini
passes `renderNode` — it has done so once already, when mono stopped using that
seam. `packages/tui/test/mini/markdown.code.test.ts` pins the
behavior — the recolor assertions are what catch a silent revert.

**Drop when:** opentui gives fenced code blocks a `baseHighlight`, or upstream
styles unhighlightable blocks itself.

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
fork(mounts)   1, 2, 3, 5, 6, 9, 10, 18, 19       additive; never conflicts
fork(7)        7                                  after mounts (needs 5)
fork(12,13)    12, 13
fork(8)        8
fork(4)        4                                  after mounts (needs 10's terms)
fork(17)       17        ┐ each carries a "Drop when", so they sit
fork(15)       15        │ nearest the tip where --onto can lift them
fork(16)       16        ┘ out without disturbing anything below
fork(21)       21
fork(22)       22                                 new file + additive call sites
fork(23)       23                                 new file + additive call sites
fork(24)       24                                 new file + additive call sites
fork(25)       25                                 new file + additive call sites
fork(26)       26                                 after 24 (extends its focus)
fork(27)       27                                 additive menu entries
fork(28)       28                                 packages/cli + shared TUI code
fork(29)       29                                 after 28 (fixes what it exposes)
fork(30)       30                                 new file + two call sites
fork(31)       31                                 two imports + one statement
fork(32)       32                                 new file + two call sites
fork(33)       33        three commits: core/protocol, the keyed Show, the TUI
fork(34)       34                                 one flag in a small file
fork(35)       35                                 one function + a list export
fork(docs)     FORK.md                            amended, not rewritten
fork(rebase)   —                                  re-derivations, when needed
```

`fork(rebase)` is the exception to one-commit-per-entry: when upstream moves code
out from under several entries at once, the fixes land together at the tip rather
than being amended into each entry's commit, because amending mid-stack
invalidates every `rerere` resolution above it. The trade is that an entry's diff
is no longer confined to its own commit — `git log -S` per entry, not `git show`.

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
| `packages/plugin/src/tui/context.ts` | every slot entry, plus 5, 6, 7 |
| `packages/tui/src/component/prompt/index.tsx` | 1, 2, 4, 12, 16, 18 |
| `packages/tui/src/routes/session/index.tsx` | 3, 4, 9, 10, 15, 18 |
| `packages/tui/src/app.tsx` | 5, 6, 7 (provider mount), 10 |
| `packages/tui/src/context/terminal.tsx` (new) | 5, 6, 7 |
| `packages/tui/src/plugin/api.tsx` | 5, 6, 7 |
| `packages/tui/src/plugin/context.tsx` | 13 |
| `packages/tui/src/feature-plugins/prompt/footer.tsx` | 12, 13 |
| `packages/tui/src/routes/session/sidebar.tsx` | 9, 19 |
| `packages/tui/src/util/selection.ts` | 7, 17 |
| `packages/tui/src/mini/runtime.lifecycle.ts` | 22, 24, 25, 26, 30 |
| `packages/tui/src/mini/runtime.ts` | 22, 24, 26, 28, 29 |
| `packages/tui/src/mini/footer.view.tsx` | 22, 23, 26, 27 |
| `packages/tui/src/mini/footer.ts` | 22, 23, 26, 30 |
| `packages/tui/src/config/index.tsx` | 12, 30 |
| `packages/tui/src/mini/scrollback.surface.ts` | 31, 32 |
| `packages/tui/src/mini/theme.ts` | 30, 32 |
| `packages/tui/src/mini/attention.ts` (new) | 24, 26 |
| `packages/tui/src/mini/types.ts` | 23, 26, 28 |

Everything else is a single-entry file or an entirely new one. The `mini/*`
rows are additive one- and two-line call sites rather than replaced logic, so
they merge in the quiet way described below — with entry 29 the exception, a
condition edited inside upstream's own expression.

### Known upstream collisions

- **Upstream's slot vocabulary is not stable, in either direction** — names get
  added, deleted, and occasionally reinstated. A deleted name that this fork
  mounts or gates becomes the fork's to carry; that is how item 10 owns the
  `app.bottom` mount. Now that `SlotMap` is typed, a removal fails to compile
  rather than silently rendering nothing. A name *returning* is the quieter
  direction: nothing fails, the fork simply stops gating a surface it should
  gate, so entries that gate a *set* of surfaces (item 10) need their invariant
  re-read rather than a clean apply trusted.
- **An entry's anchor can be deleted rather than moved, and then it is a drop
  decision, not a merge.** The signal is an invariant that no longer *can* hold —
  a slot positioned relative to something upstream no longer renders — usually
  paired with upstream having absorbed the feature the consumer plugin provided.
  Retire the entry rather than re-anchoring it somewhere its documented position
  no longer describes. Contrast items 12 and 13, whose anchors moved into a
  feature plugin and survived intact: a move is a merge, a deletion is a
  decision.
- `packages/client/src/**` is generated. After rebasing items 8 or 33, rerun
  `bun run generate` in `packages/client` rather than resolving conflicts by
  hand — `git checkout --ours` those paths first, then regenerate, then `git add`.
- **A schema field upstream adds reaches this fork twice, and neither hit
  conflicts.** When `Project` gained a required `canonical`, the regenerated
  client changed item 8's `PluginRpcOutput` (caught only by rerunning `generate`)
  and the fork's *own test fixtures* stopped compiling — upstream updates its
  fixtures in the same commit, so only the fork's hand-built session literals in
  `test/mini/runtime.test.ts` were left behind. Both surface at typecheck, so the
  rule is that a clean rebase is not evidence of a clean tree: regenerate and
  typecheck before believing it.
- **The plugin context keeps gaining neighbours, and it has now moved house.**
  Upstream added `storage` and `ui.tabs` to `Context`, both landing in exactly the
  two spots items 5–7 edit (the hook block and the context literal). These
  conflict every time and are always a union merge: keep both sides. The one to
  read rather than union is `theme`/`attention`, where upstream and the fork write
  adjacent lines for different reasons — upstream's typed `get theme()` alongside
  item 6's `attention: attentionApi` wrapper.

  Both spots now live in `plugin/api.tsx` rather than `plugin/context.tsx` (see
  [the plugin-context note](#plugin-context)). That relocation does *not* present
  as a move: the fork's hunks conflict against a `plugin/context.tsx` that has
  been gutted, and the correct resolution is to take upstream's file whole
  (`git checkout --ours`) and re-apply the fork's fields into `api.tsx` by hand.
  Replaying the diff in place instead compiles nothing and wastes the conflict.
  Expect the same shape whenever upstream extracts a file this fork writes into.
- **Theme token reads will not conflict, but they do break.** Items 4, 13, 18,
  and 19 expose theme tokens to plugins through slot-input getters. Core owns
  that token shape and has changed it repeatedly: callables like
  `themeV2.text.subdued()` became plain getters, `hue.accent(500)` became
  `hue.accent[500]`, the `themeV2` binding itself is now just `theme` (with
  `useTheme()`/`useThemes()` split apart, and the resolver extracted to the
  `@opencode-ai/theme` package), and most recently `useThemes().contextual(name)`
  became `useTheme(name)` — the contextual sets now hang off
  `ComponentTheme.contextual`, with the raw tokens exposed as
  `themes.currentTokens()`. Those reads sit in fork-only blocks, so a rebase
  applies them silently and only the typecheck catches it — after any rebase,
  grep `packages/tui/src` for `themeV2` and `contextual(` and compare surviving
  reads against `packages/tui/src/theme/component.ts`. Note what makes that last
  rename cost nothing: every fork block reads a `theme` binding that *upstream's
  own line* establishes, so a change to how the binding is obtained lands in
  upstream's hunk rather than the fork's. Reads that resolve their own tokens are
  the ones to check. The *plugin-facing* contract is unaffected: consumers see a
  getter returning a color either way, so a token reshuffle never requires plugin
  changes.
- **Feature plugins own more of the UI than they used to.** Upstream keeps moving
  core rendering out of routes and shared components into built-ins under
  `packages/tui/src/feature-plugins/`, reached through its own slots. When an
  entry's anchor disappears from a route, look there before re-deriving from
  scratch — items 12 and 13 moved to `feature-plugins/prompt/footer.tsx` intact.
  Two things to carry over when that happens: read host contexts through their
  optional hooks, since upstream unit-tests these components with no provider
  tree, and remember that importing `plugin/context` from a built-in closes an
  import cycle through `plugin/builtins.ts`.
- **The theme registry's own names move too.** Item 30 imports from
  `packages/tui/src/theme` rather than reading tokens, and upstream's move to
  native v2 themes renamed `ThemeJson` to `ThemeV1Json` and replaced `isTheme`
  with `isThemeSource` (which now admits v2 documents the v1 resolver cannot
  read). Same failure mode as the token reads: no conflict, caught only by the
  typecheck.
- **The mini statusline is a moving target.** Its layout was breakpoint flags on
  `footerWidthPolicy`; it is now a measured allocator, `footerStatuslinePolicy`,
  which hands each section a width and returns what fits. Items 23 and 26 both
  render into that row, so a rework there is re-derivation work, not a merge —
  read their invariants first.

### Tests carrying the new surface

- Plugin-context fixtures: `packages/core/test/plugin/host.ts`,
  `packages/core/test/plugin/fixture.ts`, and the RPC lifecycle test in
  `packages/core/test/plugin.test.ts`.
- TUI: `packages/tui/test/util/selection.test.ts` and
  `packages/tui/test/util/session.test.ts` (items 7 and 13), plus item 17's
  `selection-text.test.ts` and `selection-text.render.test.ts`, item 33's
  `test/session/unqueue.test.ts`, and item 35's
  `test/plugin-entrypoint.test.ts` — the last of which is the only guard that
  builds *directory* plugin fixtures, the shape upstream's own plugin tests
  never use and the reason its bug went unnoticed.
- **Upstream tests that fork entries must keep passing**, which is a different
  obligation from the fork's own guards:
  `packages/tui/test/feature-plugins/prompt-footer.test.tsx` renders the built-in
  prompt footer with a hand-built context and no provider tree, so items 12 and 13
  live or die by their optional context reads;
  `packages/core/test/session-runner.test.ts` holds item 33's seven revoke tests
  alongside upstream's, so they have to be written against whatever model harness
  upstream currently uses (`TestLLM.push` / `TestLLM.gate` today, a bare
  `responses` array before that).
- Mini: `packages/tui/test/mini/runtime.test.ts` carries items 28 and 29 —
  remembered-model precedence, and the variant surviving a refresh that lands
  before the catalog publishes variants. `packages/tui/test/mini/theme.named.test.ts`
  carries item 30; the quantization and transparent-background assertions there
  are the ones that catch a silently reverted invariant.
  `packages/tui/test/mini/scrollback.parsers.test.ts` carries item 31 and needs
  the opentui grammar cache (or network on a cold one);
  `packages/tui/test/mini/markdown.code.test.ts` carries item 32.
  `packages/tui/test/mini/provider-usage.test.ts` pins item 26's place in the
  statusline budget — that usage is dropped ahead of the model, and that an
  absent segment costs the other sections nothing — while
  `provider-usage.view.test.tsx` asserts the measured width equals what the
  segment actually draws.

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
recently `@opencode-ai/theme`), and a stale `node_modules` reports the resulting
unresolved imports as dozens of unrelated Effect type errors across `core`.

Use the workspace's own checker. `bun turbo typecheck` runs `tsgo`; a bare
`bunx tsc --noEmit` disagrees with it (it reports errors in files no entry
touches, such as `component/dialog-move-session.tsx`, and stack-overflows if
pointed at the repo root). Those are not fork regressions.

The TUI suite includes app-lifecycle tests rendering the new provider stack, the
RPC register → call → dispose-on-unload test in the core plugin suite, and items
17's two guards (`test/util/selection-text.test.ts` and
`test/util/selection-text.render.test.ts`).

Known noise, all pre-existing and unrelated to fork changes:

- The TUI suite is **intermittent**, and the flake now has a name:
  `test/app-lifecycle.test.tsx`'s "session title generated while an untitled
  session is loading remains visible" fails roughly one run in three. It is
  upstream's — the file carries no fork diff, and a clean `v2` worktree fails it
  at the same rate (2 of 6 runs, against 2 of 6 on the fork). Re-run before
  treating a lone TUI failure as a regression, and check the name against this
  one before investigating.
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
The one visible addition without any plugin is item 10's `app.bottom` mount,
which renders nothing when nothing registers into it.
