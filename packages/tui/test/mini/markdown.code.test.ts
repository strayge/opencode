import { afterEach, expect, test } from "bun:test"
import { CodeRenderable, RGBA, SyntaxStyle, TextRenderable } from "@opentui/core"
import { createTestRenderer, type TestRenderer } from "@opentui/core/testing"
import { hasHighlighting, markdownRenderNode } from "../../src/mini/markdown.code"

const active: TestRenderer[] = []

afterEach(() => {
  for (const renderer of active.splice(0)) renderer.destroy()
})

async function context(renderable: () => unknown) {
  const out = await createTestRenderer({ width: 80 })
  active.push(out.renderer)
  let calls = 0
  return {
    // The renderer exposes no RenderContext until it renders; the root
    // renderable carries the one every child is constructed against.
    ctx: Reflect.get(out.renderer.root, "_ctx") as never,
    calls: () => calls,
    context: {
      syntaxStyle: SyntaxStyle.fromTheme([]),
      conceal: false,
      concealCode: false,
      defaultRender: () => {
        calls += 1
        return renderable() as never
      },
    } as never,
  }
}

function codeToken(lang?: string) {
  return { type: "code", raw: "", text: "x = 1", lang } as never
}

test("languages with a registered parser", () => {
  // Bundled by opentui.
  for (const lang of ["javascript", "js", "typescript", "ts", "markdown", "md", "zig"]) {
    expect(hasHighlighting(lang)).toBe(true)
  }
  // Registered from parsers-config (entry 31).
  for (const lang of ["python", "py", "bash", "sh", "rust", "go", "yaml", "yml", "json", "lua"]) {
    expect(hasHighlighting(lang)).toBe(true)
  }
})

test("languages without one", () => {
  expect(hasHighlighting(undefined)).toBe(false)
  expect(hasHighlighting("")).toBe(false)
  expect(hasHighlighting("notalang")).toBe(false)
  // infoStringToFiletype passes these through unchanged rather than aliasing
  // them onto bash/go, so no parser claims them.
  expect(hasHighlighting("shell")).toBe(false)
  expect(hasHighlighting("golang")).toBe(false)
})

test("an unlabeled fence is recolored", async () => {
  const harness = await context(
    () =>
      new CodeRenderable(harness.ctx, {
        content: "x = 1",
        syntaxStyle: SyntaxStyle.fromTheme([]),
      }),
  )
  const color = RGBA.fromHex("#a4b248")
  const result = markdownRenderNode(color)(codeToken(), harness.context)
  expect(harness.calls()).toBe(1)
  expect(result).toBeInstanceOf(CodeRenderable)
  expect((result as CodeRenderable).fg?.toInts().slice(0, 3)).toEqual(color.toInts().slice(0, 3))
})

test("an unknown language is recolored too", async () => {
  const harness = await context(
    () =>
      new CodeRenderable(harness.ctx, {
        content: "x = 1",
        syntaxStyle: SyntaxStyle.fromTheme([]),
      }),
  )
  const color = RGBA.fromHex("#a4b248")
  const result = markdownRenderNode(color)(codeToken("notalang"), harness.context)
  expect((result as CodeRenderable).fg?.toInts().slice(0, 3)).toEqual(color.toInts().slice(0, 3))
})

test("a highlightable fence is left to default rendering", async () => {
  const harness = await context(() => {
    throw new Error("defaultRender should not be called")
  })
  for (const lang of ["python", "typescript", "bash"]) {
    expect(markdownRenderNode(RGBA.fromHex("#a4b248"))(codeToken(lang), harness.context)).toBeUndefined()
  }
  expect(harness.calls()).toBe(0)
})

test("non-code tokens are untouched", async () => {
  const harness = await context(() => new TextRenderable(harness.ctx, { content: "q" }))
  const quote = { type: "blockquote", raw: "> q", text: "q", tokens: [] } as never

  expect(markdownRenderNode(RGBA.fromHex("#a4b248"))(quote, harness.context)).toBeUndefined()
  expect(harness.calls()).toBe(0)
})
