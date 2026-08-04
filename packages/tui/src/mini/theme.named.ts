// Named-theme resolution for mini.
//
// Mini's own colors come from the terminal palette (see ./theme). This module
// adds the opt-in alternative: `mini.theme` names a theme from the same
// registry the full TUI reads, and its colors are used verbatim. With the
// setting absent the palette-derived path runs untouched, so the default look
// is unchanged.
//
// Two properties of the palette-derived path are deliberately not carried over:
//
//   - No quantization. The system theme snaps scrollback colors onto the
//     nearest terminal palette entry so mini looks native in any terminal.
//     Doing that to an authored theme would substitute the terminal's
//     approximation for the colors the theme actually asked for -- a jade
//     accent becomes whatever that terminal calls cyan.
//   - The background stays transparent. Mini writes scrollback into the real
//     terminal scrollback buffer, where it cannot own a background. Painting
//     the live footer with an opaque theme background would only produce a
//     seam against the scrollback above it.
import { RGBA, type CliRenderer } from "@opentui/core"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/v1/tui"
import { terminalMode } from "../theme/system"
import type { ThemeV1Json } from "../theme/v1"
import { map, resolveRunTheme, resolveTheme, type RunSplashTheme, type RunTheme } from "./theme"
import type { RunTuiConfig } from "./types"

type ThemeConfig = Pick<RunTuiConfig, "theme" | "mini">

// Reserved selections. A theme file using either name is shadowed by them.
const SYSTEM = "system"
const INHERIT = "inherit"

let customThemes: Promise<Record<string, ThemeV1Json>> | undefined

/**
 * Discovery reads the filesystem and mini re-resolves its theme on every
 * palette change plus two delayed retries, so the scan is cached for the
 * process. Exposed for tests, which need a clean slate per case.
 */
export function resetCustomThemeCache(): void {
  customThemes = undefined
}

/**
 * The theme name mini should render, or undefined to stay on the terminal
 * palette. Kept separate from the lookup so the precedence rules are testable
 * without a renderer.
 */
export function namedThemeSelection(config: ThemeConfig): string | undefined {
  const requested = config.mini?.theme?.trim()
  if (!requested || requested === SYSTEM) return undefined
  if (requested !== INHERIT) return requested

  const inherited = config.theme?.name?.trim()
  if (!inherited || inherited === SYSTEM) return undefined
  return inherited
}

async function discoverCustomThemes(): Promise<Record<string, ThemeV1Json>> {
  const [discovery, directories, global, registry] = await Promise.all([
    import("../theme/discovery"),
    import("../util/config-directories"),
    import("@opencode-ai/util/global"),
    import("../theme"),
  ])

  // OPENCODE_CONFIG_DIR relocates the whole config tree, themes included. The
  // compiled-in Global.Path.config ignores it, so reading that alone would miss
  // every theme belonging to a relocated install.
  const directory = process.env.OPENCODE_CONFIG_DIR ?? global.Global.Path.config
  const discovered = await discovery.discoverThemes(directories.configDirectories(directory, process.cwd()))
  const result: Record<string, ThemeV1Json> = {}
  for (const [name, theme] of Object.entries(discovered)) {
    if (!registry.isThemeSource(theme)) continue
    if (!isVersionOneTheme(theme)) continue
    result[name] = theme
  }
  return result
}

/**
 * Mini resolves colors through the v1 path (`resolveTheme` reads a
 * `ThemeV1Json`), so a natively authored v2 theme document has no route into
 * `map` and is left to the palette-derived fallback rather than thrown at a
 * resolver that cannot read it. Every bundled theme is still v1, so this only
 * concerns hand-written theme files. `parseTheme` treats a missing `version`
 * as 1, and this matches it.
 */
function isVersionOneTheme(source: Record<string, unknown>): source is ThemeV1Json {
  return (source["version"] ?? 1) === 1
}

async function themeByName(name: string): Promise<ThemeV1Json | undefined> {
  const { DEFAULT_THEMES } = await import("../theme")
  const bundled = DEFAULT_THEMES[name]
  if (bundled) return bundled

  customThemes ??= discoverCustomThemes().catch(() => ({}))
  return (await customThemes)[name]
}

function tint(base: RGBA, overlay: RGBA, value: number): RGBA {
  return RGBA.fromInts(
    Math.round((base.r + (overlay.r - base.r) * value) * 255),
    Math.round((base.g + (overlay.g - base.g) * value) * 255),
    Math.round((base.b + (overlay.b - base.b) * value) * 255),
  )
}

function splashFor(theme: TuiThemeCurrent): RunSplashTheme {
  const left = theme.textMuted
  return {
    left,
    right: theme.text,
    leftShadow: tint(theme.background, left, 0.14),
  }
}

function keepTerminalBackground(theme: TuiThemeCurrent): TuiThemeCurrent {
  const background = theme.background
  if (background.a === 0) return theme
  // A new RGBA rather than a mutation: resolveThemeColors aliases this object
  // into selectedListItemText when a theme omits that key.
  return {
    ...theme,
    background: RGBA.fromValues(background.r, background.g, background.b, 0),
  }
}

async function resolveMode(renderer: CliRenderer, config: ThemeConfig): Promise<"dark" | "light"> {
  const configured = config.theme?.mode
  if (configured === "dark" || configured === "light") return configured

  // Unlike the system theme, a named theme needs the palette only to tell dark
  // from light -- a failed probe costs a mode guess, not the whole theme.
  const colors = await renderer.getPalette({ size: 16 }).catch(() => undefined)
  const detected = colors ? terminalMode(colors) : undefined
  if (detected) return detected
  if (renderer.themeMode) return renderer.themeMode

  const waited = await renderer.waitForThemeMode(300).catch(() => null)
  return waited === "light" ? "light" : "dark"
}

/**
 * Mini's theme entry point. Delegates to the palette-derived resolveRunTheme
 * unless a named theme is both configured and resolvable, so every failure mode
 * -- absent setting, unknown name, unreadable file, malformed colors -- lands on
 * the default look rather than stopping startup.
 */
export async function resolveMiniTheme(
  renderer: CliRenderer,
  config: ThemeConfig,
  mono = false,
): Promise<RunTheme> {
  // Mono is a stronger statement than a palette: it wins over a named theme.
  const name = mono ? undefined : namedThemeSelection(config)
  if (!name) return resolveRunTheme(renderer, config.theme, mono)

  const theme = await themeByName(name).catch(() => undefined)
  if (!theme) return resolveRunTheme(renderer, config.theme, mono)

  try {
    const mode = await resolveMode(renderer, config)
    // resolveThemeColors throws on circular or missing color references.
    const resolved = keepTerminalBackground(resolveTheme(theme, mode))
    const { generateSyntax } = await import("../theme")
    return map(
      resolved,
      resolved,
      splashFor(resolved),
      generateSyntax({ ...resolved, _hasSelectedListItemText: true }),
    )
  } catch {
    return resolveRunTheme(renderer, config.theme, mono)
  }
}
