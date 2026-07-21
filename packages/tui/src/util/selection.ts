import { isRenderable } from "@opentui/core"
import type { ClipboardService } from "../context/clipboard"
import type { TerminalSelection } from "../context/terminal"
import { selectedText } from "./selection-text"

type Toast = {
  show: (input: { message: string; variant: "info" | "success" | "warning" | "error" }) => void
  error: (err: unknown) => void
}

type FocusableSelectionTarget = {
  hasSelection: () => boolean
  getClipboardText?: (text: string) => string
}

type Renderer = {
  getSelection: () => { getSelectedText: () => string; selectedRenderables: FocusableSelectionTarget[] } | null
  clearSelection: () => void
  currentFocusedRenderable?: FocusableSelectionTarget | null
}

type SelectionKeyEvent = {
  ctrl?: boolean
  shift?: boolean
  name: string
  preventDefault: () => void
  stopPropagation: () => void
}

export function copy(
  renderer: Renderer,
  toast: Toast,
  clipboard: ClipboardService,
  transform?: (selection: TerminalSelection) => string | undefined,
): boolean {
  const selection = renderer.getSelection()
  if (!selection) return false

  const text = selectedText(selection)
  if (!text) return false

  const focus = renderer.currentFocusedRenderable
  const clipboardText =
    transform?.({ text, renderables: selection.selectedRenderables.filter(isRenderable) }) ??
    (focus?.getClipboardText && selection.selectedRenderables.includes(focus) ? focus.getClipboardText(text) : text)

  clipboard
    ?.write?.(clipboardText)
    .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
    .catch(toast.error)

  renderer.clearSelection()
  return true
}

export function handleSelectionKey(
  renderer: Renderer,
  toast: Toast,
  event: SelectionKeyEvent,
  clipboard: ClipboardService,
  transform?: (selection: TerminalSelection) => string | undefined,
) {
  const selection = renderer.getSelection()
  if (!selection) return

  if (event.ctrl && event.name === "c") {
    if (!copy(renderer, toast, clipboard, event.shift ? transform : undefined)) {
      renderer.clearSelection()
      return
    }

    event.preventDefault()
    event.stopPropagation()
    return
  }

  if (event.name === "escape") {
    renderer.clearSelection()
    event.preventDefault()
    event.stopPropagation()
    return
  }

  const focus = renderer.currentFocusedRenderable
  if (focus?.hasSelection() && selection.selectedRenderables.includes(focus)) return

  renderer.clearSelection()
}

export * as Selection from "./selection"
