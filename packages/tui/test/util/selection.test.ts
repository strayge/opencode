import { describe, expect, test } from "bun:test"

import { Selection } from "../../src/util/selection"

function setup() {
  const writes: string[] = []
  let cleared = 0
  const selected = { hasSelection: () => true }
  const renderer = {
    getSelection: () => ({ getSelectedText: () => "rendered", selectedRenderables: [selected] }),
    clearSelection: () => cleared++,
    currentFocusedRenderable: null,
  }
  const toast = { show() {}, error(error: unknown) { throw error } }
  const clipboard = { async write(text: string) { writes.push(text) } }
  return { renderer, toast, clipboard, writes, cleared: () => cleared }
}

describe("selection copy", () => {
  test("uses a transform when it returns text", async () => {
    const value = setup()
    expect(Selection.copy(value.renderer, value.toast, value.clipboard, () => "**source**")).toBe(true)
    await Promise.resolve()
    expect(value.writes).toEqual(["**source**"])
    expect(value.cleared()).toBe(1)
  })

  test("falls back to rendered text when a transform declines", async () => {
    const value = setup()
    expect(Selection.copy(value.renderer, value.toast, value.clipboard, () => undefined)).toBe(true)
    await Promise.resolve()
    expect(value.writes).toEqual(["rendered"])
  })

  test("only applies the transform for modified ctrl+c", async () => {
    const plain = setup()
    Selection.handleSelectionKey(
      plain.renderer,
      plain.toast,
      { ctrl: true, shift: false, name: "c", preventDefault() {}, stopPropagation() {} },
      plain.clipboard,
      () => "source",
    )
    await Promise.resolve()
    expect(plain.writes).toEqual(["rendered"])

    const alternate = setup()
    Selection.handleSelectionKey(
      alternate.renderer,
      alternate.toast,
      { ctrl: true, shift: true, name: "c", preventDefault() {}, stopPropagation() {} },
      alternate.clipboard,
      () => "source",
    )
    await Promise.resolve()
    expect(alternate.writes).toEqual(["source"])
  })
})
