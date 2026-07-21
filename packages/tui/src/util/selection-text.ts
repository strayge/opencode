type SelectionSource = {
  getSelectedText: () => string
  selectedRenderables: unknown[]
}

type PlacedSelection = {
  x: number
  y: number
  height: number
  isDestroyed?: boolean
  getSelectedText: () => string
}

function isPlaced(candidate: unknown): candidate is PlacedSelection {
  if (typeof candidate !== "object" || candidate === null) return false
  const placed = candidate as Partial<PlacedSelection>
  return (
    typeof placed.x === "number" &&
    typeof placed.y === "number" &&
    typeof placed.height === "number" &&
    typeof placed.getSelectedText === "function"
  )
}

/**
 * Rows the renderable's own text occupies, which is not its box height.
 *
 * A list marker stretches to the height of the whole list item, so a one-row
 * `"5. "` can report a height of 11 and would otherwise claim every gap row
 * inside the item. The text buffer's virtual line count is the wrapped row
 * count of the text itself. Height still caps it, so a clipped renderable never
 * claims rows it does not draw.
 */
function visualRows(candidate: PlacedSelection) {
  const view = Reflect.get(candidate, "textBufferView")
  if (typeof view === "object" && view !== null) {
    const read = Reflect.get(view, "getVirtualLineCount")
    if (typeof read === "function") {
      const count = Reflect.apply(read, view, [])
      if (typeof count === "number" && count > 0) return Math.min(count, candidate.height)
    }
  }
  return candidate.height
}

/**
 * Composes selected text while preserving blank rows.
 *
 * OpenTUI's own `Selection.getSelectedText()` collects one entry per row that a
 * renderable wrote text on, then joins those entries with a single newline. Row
 * numbers drive sorting only, so any row nothing wrote to disappears. Markdown
 * block spacing is exactly such a row: `MarkdownRenderable` separates top-level
 * blocks (and loose list items) with a yoga margin rather than with text, so
 * copying a multi-paragraph selection ran the paragraphs together.
 *
 * A row counts as blank only when no selected renderable's text covers it.
 * `getSelectedText()` yields logical lines and leaves soft wraps unbroken, so a
 * wrapped paragraph occupies more rows than it reports lines; those extra rows
 * are consumed by the wrap and must not become blank lines. Coverage measures
 * the text rather than the box (see `visualRows`) and excludes the margin,
 * leaving exactly the inter-block gap uncovered.
 *
 * Bounds come from occupied rows, never from the selection rectangle, so a
 * selection keeps starting and ending on text instead of gaining leading or
 * trailing blank lines.
 */
export function selectedText(selection: SelectionSource) {
  const rows = new Map<number, Array<{ x: number; text: string }>>()
  const covered = new Set<number>()
  let top = Infinity
  let bottom = -Infinity

  for (const candidate of selection.selectedRenderables) {
    if (!isPlaced(candidate) || candidate.isDestroyed) continue
    const text = candidate.getSelectedText()
    if (!text) continue
    const rowCount = visualRows(candidate)
    for (let row = candidate.y; row < candidate.y + rowCount; row += 1) covered.add(row)
    text.split("\n").forEach((line, index) => {
      const y = candidate.y + index
      const row = rows.get(y) ?? []
      row.push({ x: candidate.x, text: line })
      rows.set(y, row)
      if (y < top) top = y
      if (y > bottom) bottom = y
    })
  }

  // Nothing usable to place on a row: defer to the built-in composition, which
  // returns "" for an empty selection and keeps the "nothing selected" guard in
  // `copy()` intact.
  if (rows.size === 0) return selection.getSelectedText()

  const lines: string[] = []
  for (let y = top; y <= bottom; y += 1) {
    const row = rows.get(y)
    if (row) {
      lines.push(
        row
          .toSorted((left, right) => left.x - right.x)
          .map((segment) => segment.text)
          .join(""),
      )
      continue
    }
    if (covered.has(y)) continue
    lines.push("")
  }
  return lines.join("\n")
}
