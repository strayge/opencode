import { afterEach, describe, expect, test } from "bun:test"
import { MarkdownRenderable, RGBA, SyntaxStyle } from "@opentui/core"
import { createTestRenderer, type TestRenderer } from "@opentui/core/testing"

import { selectedText } from "../../src/util/selection-text"

const active: TestRenderer[] = []

afterEach(() => {
  for (const renderer of active.splice(0)) renderer.destroy()
})

/**
 * Renders markdown the way the session transcript does and drag-selects all of
 * it, so the assertions run against real layout geometry rather than a
 * hand-built fixture. Every regression this file guards came from geometry the
 * synthetic tests could not express: soft wraps, and stretched list markers.
 */
async function copySelection(content: string, width = 80) {
  const setup = await createTestRenderer({ width, height: 40 })
  active.push(setup.renderer)
  const ctx = Reflect.get(setup.renderer.root, "_ctx") as ConstructorParameters<typeof MarkdownRenderable>[0]
  const markdown = new MarkdownRenderable(ctx, {
    content,
    syntaxStyle: SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } }),
    streaming: false,
    internalBlockMode: "top-level",
    conceal: true,
    fg: RGBA.fromInts(255, 255, 255, 255),
  })
  setup.renderer.root.add(markdown)
  await setup.flush()

  await setup.mockMouse.drag(0, 0, width - 2, markdown.height)
  await setup.flush()

  const selection = setup.renderer.getSelection()
  if (!selection) throw new Error("drag produced no selection")
  return selectedText(selection)
}

describe("selectedText over a real render", () => {
  test("keeps one blank line between top-level blocks", async () => {
    const copied = await copySelection(
      [
        "First paragraph that is long enough to wrap across more than a single row of the terminal.",
        "",
        "Second paragraph, also long enough that it has to wrap onto another row somewhere.",
      ].join("\n"),
    )
    expect(copied.split("\n\n")).toHaveLength(2)
    expect(copied.startsWith("First paragraph")).toBe(true)
    expect(copied).toContain("\n\nSecond paragraph")
  })

  test("keeps blank lines between paragraphs nested in a list item", async () => {
    // The list marker renderable stretches to the height of the whole item, so
    // measuring coverage by box height would swallow every gap row inside it.
    const copied = await copySelection(
      [
        "5. **Low | Test Coverage:** Downstream terminal filtering does not explicitly pin behavior  ",
        "   **References:** `common/resources/order.py:31-40`, `load/logic/calculations.py:47-56`",
        "",
        "   **Simple explanation:**  ",
        "   Correctly included in the helper, but load and planner tests do not verify it.",
        "",
        "   **Detailed explanation:**  ",
        "   Station load excludes terminal orders through the shared helper.",
      ].join("\n"),
    )
    // `conceal` hides the emphasis markers, so match the rendered wording.
    expect(copied).toContain("\n\nSimple explanation:")
    expect(copied).toContain("\n\nDetailed explanation:")
    expect(copied).not.toContain("\n\n\n")
  })

  test("does not insert blank lines inside a wrapped paragraph", async () => {
    const copied = await copySelection(
      [
        "A single logical line long enough to wrap across several rows of an eighty column terminal without any break in it at all.",
        "",
        "Tail paragraph.",
      ].join("\n"),
    )
    expect(copied.split("\n")).toHaveLength(3)
    expect(copied.endsWith("\n\nTail paragraph.")).toBe(true)
  })
})
