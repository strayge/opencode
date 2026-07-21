import { describe, expect, test } from "bun:test"

import { selectedText } from "../../src/util/selection-text"

function placed(y: number, text: string, options: { x?: number; height?: number; isDestroyed?: boolean } = {}) {
  return {
    x: options.x ?? 0,
    y,
    height: options.height ?? text.split("\n").length,
    isDestroyed: options.isDestroyed ?? false,
    getSelectedText: () => text,
  }
}

function source(renderables: unknown[], rendered = "built-in") {
  return { getSelectedText: () => rendered, selectedRenderables: renderables }
}

describe("selectedText", () => {
  test("keeps the blank row between markdown blocks", () => {
    expect(selectedText(source([placed(4, "First paragraph"), placed(6, "Second paragraph")]))).toBe(
      "First paragraph\n\nSecond paragraph",
    )
  })

  test("does not turn soft-wrapped rows into blank lines", () => {
    // One logical line occupying three rows, then a one-row margin.
    const wrapped = placed(0, "a very long single logical line", { height: 3 })
    expect(selectedText(source([wrapped, placed(4, "next block")]))).toBe(
      "a very long single logical line\n\nnext block",
    )
  })

  test("separates blocks by the uncovered rows only", () => {
    // Two logical lines where the second wraps onto a third row, margin at row 3.
    const paragraph = placed(0, "heading\nbody that wraps", { height: 3 })
    expect(selectedText(source([paragraph, placed(4, "after")]))).toBe("heading\nbody that wraps\n\nafter")
  })

  test("keeps every row of a wider gap", () => {
    expect(selectedText(source([placed(0, "top"), placed(4, "bottom")]))).toBe("top\n\n\n\nbottom")
  })

  test("places multi-line text on consecutive rows", () => {
    expect(selectedText(source([placed(2, "one\ntwo"), placed(5, "four")]))).toBe("one\ntwo\n\nfour")
  })

  test("joins segments sharing a row by column", () => {
    expect(selectedText(source([placed(1, "world", { x: 5 }), placed(1, "hello ")]))).toBe("hello world")
  })

  test("adds no leading or trailing blank rows", () => {
    expect(selectedText(source([placed(9, "only")]))).toBe("only")
  })

  test("ignores destroyed renderables", () => {
    expect(selectedText(source([placed(0, "kept"), placed(2, "gone", { isDestroyed: true })]))).toBe("kept")
  })

  test("defers to the built-in composition when nothing is placed", () => {
    expect(selectedText(source([{ hasSelection: () => true }]))).toBe("built-in")
  })

  test("defers to the built-in composition for an empty selection", () => {
    expect(selectedText(source([placed(0, "")], ""))).toBe("")
  })
})
