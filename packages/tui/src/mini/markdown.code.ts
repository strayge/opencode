// Distinct color for fenced code blocks mini cannot highlight.
//
// MarkdownRenderable renders every fence through a CodeRenderable whose
// filetype comes from the fence's info string, and passes no baseHighlight.
// When no parser matches -- an unlabeled fence, or a language nothing registers
// -- tree-sitter returns no highlights at all and the entire block falls back to
// the renderable's `fg`, which MarkdownRenderable sets to the surrounding
// entry's text color. The block then renders identically to prose, with nothing
// marking it as code.
//
// Recoloring those blocks is the only available signal. It cannot come from the
// syntax style: the markdown grammar does scope fences as `markup.raw.block`,
// but MarkdownRenderable replaces the fence with its own CodeRenderable, so
// that scope never reaches the rendered block.
import { CodeRenderable, infoStringToFiletype, type ColorInput, type MarkdownOptions } from "@opentui/core"
import parsers from "../parsers-config"

// Bundled by opentui itself; everything else arrives through parsers-config.
const BUILTIN_FILETYPES = [
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
  "markdown",
  "markdown_inline",
  "zig",
]

const highlightable = new Set<string>([
  ...BUILTIN_FILETYPES,
  ...parsers.parsers.flatMap((parser) => {
    const aliases = "aliases" in parser && parser.aliases ? parser.aliases : []
    return [parser.filetype, ...aliases]
  }),
])

/**
 * Whether a fence's info string names a language some parser claims.
 *
 * infoStringToFiletype only normalizes aliases -- it returns unknown strings
 * unchanged rather than undefined -- so its result still has to be checked
 * against the set of filetypes actually registered.
 */
export function hasHighlighting(lang: string | undefined): boolean {
  if (!lang) return false
  const filetype = infoStringToFiletype(lang)
  return filetype !== undefined && highlightable.has(filetype)
}

/**
 * Mini's markdown renderNode: recolors the fences nothing can highlight and
 * defers to the default rendering for every other token.
 *
 * Mono needs nothing from here -- it transforms the renderable tree itself --
 * so the two passes compose rather than having to be threaded together.
 */
export function markdownRenderNode(color: ColorInput): NonNullable<MarkdownOptions["renderNode"]> {
  return (token, context) => {
    if (token.type !== "code") return undefined
    if (hasHighlighting(token.lang)) return undefined

    const renderable = context.defaultRender()
    if (renderable instanceof CodeRenderable) renderable.fg = color
    return renderable
  }
}
