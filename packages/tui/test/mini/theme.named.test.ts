import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { RGBA, type CliRenderer, type TerminalColors } from "@opentui/core"
import { RUN_THEME_MONO, resolveRunTheme, resolveTheme } from "../../src/mini/theme"
import { namedThemeSelection, resetCustomThemeCache, resolveMiniTheme } from "../../src/mini/theme.named"
import { DEFAULT_THEMES } from "../../src/theme"
import type { RunTuiConfig } from "../../src/mini/types"

const palette = ["#15161e", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5"] as const

function terminalColors(input: Partial<TerminalColors> = {}): TerminalColors {
  return {
    palette: Array.from({ length: 256 }, (_, index) => input.palette?.[index] ?? palette[index % palette.length]!),
    defaultBackground: input.defaultBackground ?? "#1a1b26",
    defaultForeground: input.defaultForeground ?? "#c0caf5",
    cursorColor: input.cursorColor ?? "#ff9e64",
    mouseForeground: input.mouseForeground ?? null,
    mouseBackground: input.mouseBackground ?? null,
    tekForeground: input.tekForeground ?? null,
    tekBackground: input.tekBackground ?? null,
    highlightBackground: input.highlightBackground ?? "#33467c",
    highlightForeground: input.highlightForeground ?? "#c0caf5",
  }
}

function renderer(input: { themeMode?: "dark" | "light"; colors?: TerminalColors; fail?: boolean } = {}) {
  return {
    themeMode: input.themeMode,
    waitForThemeMode: async () => input.themeMode ?? null,
    getPalette: async () => {
      if (input.fail) throw new Error("boom")
      return input.colors ?? terminalColors()
    },
  } as CliRenderer
}

type ThemeConfig = Pick<RunTuiConfig, "theme" | "mini">

function config(input: { name?: string; mode?: "system" | "dark" | "light"; mini?: string } = {}): ThemeConfig {
  return {
    theme: input.name === undefined && input.mode === undefined ? undefined : { name: input.name, mode: input.mode },
    mini: input.mini === undefined ? undefined : { theme: input.mini },
  }
}

function ints(color: unknown) {
  expect(color).toBeInstanceOf(RGBA)
  if (!(color instanceof RGBA)) throw new Error("expected RGBA")
  return color.toInts().slice(0, 3)
}

const accent = "#69b4a8"

/** A complete theme file, derived from a bundled one so every color key exists. */
async function writeCustomTheme(name: string, overrides: Record<string, unknown> = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "mini-theme-"))
  await mkdir(path.join(directory, "themes"), { recursive: true })
  const base = DEFAULT_THEMES["gruvbox"]!
  const theme = {
    ...base,
    theme: { ...base.theme, primary: { dark: accent, light: accent }, ...overrides },
  }
  await writeFile(path.join(directory, "themes", `${name}.json`), JSON.stringify(theme))
  process.env.OPENCODE_CONFIG_DIR = directory
  return directory
}

afterEach(() => {
  delete process.env.OPENCODE_CONFIG_DIR
  resetCustomThemeCache()
})

test("selection precedence", () => {
  expect(namedThemeSelection(config())).toBeUndefined()
  expect(namedThemeSelection(config({ mini: "" }))).toBeUndefined()
  expect(namedThemeSelection(config({ mini: "system" }))).toBeUndefined()
  expect(namedThemeSelection(config({ mini: "gruvbox" }))).toBe("gruvbox")
  expect(namedThemeSelection(config({ mini: "  gruvbox  " }))).toBe("gruvbox")

  // A top-level theme.name alone must not change mini.
  expect(namedThemeSelection(config({ name: "dracula" }))).toBeUndefined()
  expect(namedThemeSelection(config({ name: "dracula", mini: "inherit" }))).toBe("dracula")
  expect(namedThemeSelection(config({ mini: "inherit" }))).toBeUndefined()
  expect(namedThemeSelection(config({ name: "system", mini: "inherit" }))).toBeUndefined()
})

test("no selection leaves the palette-derived theme untouched", async () => {
  const named = await resolveMiniTheme(renderer(), config())
  const system = await resolveRunTheme(renderer(), undefined)
  expect(ints(named.footer.highlight)).toEqual(ints(system.footer.highlight))
  expect(ints(named.entry.user.body)).toEqual(ints(system.entry.user.body))
  // The system path quantizes scrollback onto the terminal palette.
  expect((system.entry.user.body as RGBA).intent).toBe("indexed")
  expect((named.entry.user.body as RGBA).intent).toBe("indexed")
})

test("a bundled theme resolves without quantization", async () => {
  const theme = await resolveMiniTheme(renderer(), config({ mini: "gruvbox" }))
  // Gruvbox states primary as a def reference, so compare against the resolved theme.
  const expected = resolveTheme(DEFAULT_THEMES["gruvbox"]!, "dark")
  expect(ints(theme.footer.highlight)).toEqual(ints(expected.primary))
  // Quantization would have snapped this onto a terminal palette slot.
  expect((theme.entry.user.body as RGBA).intent).not.toBe("indexed")
})

test("the background stays transparent so scrollback keeps the terminal background", async () => {
  const theme = await resolveMiniTheme(renderer(), config({ mini: "gruvbox" }))
  expect((theme.background as RGBA).a).toBe(0)
})

test("a custom theme resolves from OPENCODE_CONFIG_DIR", async () => {
  await writeCustomTheme("pitest")
  const theme = await resolveMiniTheme(renderer(), config({ mini: "pitest" }))
  expect(ints(theme.footer.highlight)).toEqual(ints(RGBA.fromHex(accent)))
})

test("inherit follows theme.name into the custom directory", async () => {
  await writeCustomTheme("pitest")
  const theme = await resolveMiniTheme(renderer(), config({ name: "pitest", mini: "inherit" }))
  expect(ints(theme.footer.highlight)).toEqual(ints(RGBA.fromHex(accent)))
})

test("an unknown name falls back to the palette-derived theme", async () => {
  const theme = await resolveMiniTheme(renderer(), config({ mini: "no-such-theme-here" }))
  const system = await resolveRunTheme(renderer(), undefined)
  expect(ints(theme.footer.highlight)).toEqual(ints(system.footer.highlight))
})

test("a malformed theme falls back instead of throwing", async () => {
  await writeCustomTheme("broken", { primary: "missingReference" })
  const theme = await resolveMiniTheme(renderer(), config({ mini: "broken" }))
  const system = await resolveRunTheme(renderer(), undefined)
  expect(ints(theme.footer.highlight)).toEqual(ints(system.footer.highlight))
})

test("mono wins over a named theme", async () => {
  expect(await resolveMiniTheme(renderer(), config({ mini: "gruvbox" }), true)).toBe(RUN_THEME_MONO)
})

test("the configured mode selects the theme variant", async () => {
  await writeCustomTheme("modal", { text: { dark: "#111111", light: "#eeeeee" } })
  const dark = await resolveMiniTheme(renderer(), config({ mode: "dark", mini: "modal" }))
  expect(ints(dark.footer.text)).toEqual([17, 17, 17])

  resetCustomThemeCache()
  const light = await resolveMiniTheme(renderer(), config({ mode: "light", mini: "modal" }))
  expect(ints(light.footer.text)).toEqual([238, 238, 238])
})

test("a named theme survives a failed palette probe", async () => {
  // Only the dark/light decision needs the palette, so the theme still renders.
  const theme = await resolveMiniTheme(renderer({ fail: true, themeMode: "dark" }), config({ mini: "gruvbox" }))
  const expected = resolveTheme(DEFAULT_THEMES["gruvbox"]!, "dark")
  expect(ints(theme.footer.highlight)).toEqual(ints(expected.primary))
})
