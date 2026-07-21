import { createContext, createEffect, createSignal, onCleanup, onMount, useContext, type ParentProps } from "solid-js"
import { useRenderer } from "@opentui/solid"
import type { Renderable } from "@opentui/core"
import { useConfig } from "../config"

export type TerminalFocus = "unknown" | "focused" | "blurred"

export type TerminalTitleDecoration = {
  /** Stable identifier; registering the same ID replaces the previous decoration. */
  id: string
  /** Higher priority renders closer to the base title. Defaults to 0. */
  priority?: number
  prefix?: () => string | undefined
  suffix?: () => string | undefined
}

export type TerminalSelection = {
  text: string
  renderables: Renderable[]
}

export type SelectionTransform = {
  id: string
  priority?: number
  run: (selection: TerminalSelection) => string | undefined
}

type Value = {
  readonly focused: () => TerminalFocus
  readonly onFocus: (handler: () => void) => () => void
  readonly onBlur: (handler: () => void) => () => void
  readonly selection: () => TerminalSelection | undefined
  readonly selectionCopy: {
    readonly transform: (input: SelectionTransform) => () => void
    readonly apply: (selection: TerminalSelection) => string | undefined
    readonly active: () => boolean
    readonly copyOnSelect: () => boolean
  }
  readonly title: {
    readonly decorate: (decoration: TerminalTitleDecoration) => () => void
  }
}

const TerminalContext = createContext<Value>()

export function TerminalProvider(props: ParentProps) {
  const renderer = useRenderer()
  const config = useConfig()

  // Core's own copy-on-select default, resolved in one place so the fork's copy
  // gestures and upstream's can never disagree about which one is active.
  const copyOnSelect = () => config.data.terminal?.copy_on_select ?? process.platform !== "win32"

  const [focus, setFocus] = createSignal<TerminalFocus>("unknown")
  const focusHandlers = new Set<() => void>()
  const blurHandlers = new Set<() => void>()
  const notify = (handlers: Set<() => void>) => {
    for (const handler of handlers) {
      try {
        handler()
      } catch (error) {
        console.debug("terminal focus handler failed", { error })
      }
    }
  }
  const onFocusEvent = () => {
    setFocus("focused")
    notify(focusHandlers)
  }
  const onBlurEvent = () => {
    setFocus("blurred")
    notify(blurHandlers)
  }

  onMount(() => {
    renderer.on("focus", onFocusEvent)
    renderer.on("blur", onBlurEvent)
    onCleanup(() => {
      renderer.off("focus", onFocusEvent)
      renderer.off("blur", onBlurEvent)
    })
  })

  const [decorations, setDecorations] = createSignal<TerminalTitleDecoration[]>([])
  const decorate = (decoration: TerminalTitleDecoration) => {
    setDecorations((list) => [...list.filter((item) => item.id !== decoration.id), decoration])
    let active = true
    return () => {
      if (!active) return
      active = false
      setDecorations((list) => list.filter((item) => item !== decoration))
    }
  }
  const compose = (base: string) => {
    const sorted = decorations().toSorted((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    const read = (render: (() => string | undefined) | undefined) => {
      if (!render) return undefined
      try {
        return render()?.trim() || undefined
      } catch (error) {
        console.debug("terminal title decoration failed", { error })
        return undefined
      }
    }
    // Highest priority ends up outermost on the left, innermost on the right.
    const prefix = sorted
      .map((item) => read(item.prefix))
      .filter((item): item is string => !!item)
      .join(" ")
    const suffix = sorted
      .toReversed()
      .map((item) => read(item.suffix))
      .filter((item): item is string => !!item)
      .join(" ")
    return [prefix, base, suffix].filter((part) => part.length > 0).join(" ")
  }

  // The application keeps writing the base title through
  // renderer.setTerminalTitle exactly as upstream does; the provider intercepts
  // the write, remembers the base, and appends registered decorations. The
  // effect reads the decoration signal plus any reactive prefix/suffix sources,
  // so plugin contributions are re-applied on change and can never be clobbered
  // by route or session-title writes. An empty base is a clear and passes
  // through raw, so decorations cannot resurrect a title the app removed.
  const [baseTitle, setBaseTitle] = createSignal<string>()
  const writeTitle = renderer.setTerminalTitle.bind(renderer)
  renderer.setTerminalTitle = (title: string) => setBaseTitle(title)
  onCleanup(() => {
    renderer.setTerminalTitle = writeTitle
  })
  createEffect(() => {
    const base = baseTitle()
    if (base === undefined) return
    writeTitle(base ? compose(base) : base)
  })

  const [selectionTransforms, setSelectionTransforms] = createSignal<SelectionTransform[]>([])
  const transformSelection = (input: SelectionTransform) => {
    setSelectionTransforms((list) => [...list.filter((item) => item.id !== input.id), input])
    let active = true
    return () => {
      if (!active) return
      active = false
      setSelectionTransforms((list) => list.filter((item) => item !== input))
    }
  }
  const applySelectionTransform = (selection: TerminalSelection) => {
    const sorted = selectionTransforms().toSorted((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    for (const item of sorted) {
      try {
        const result = item.run(selection)
        if (result !== undefined) return result
      } catch (error) {
        console.debug("terminal selection transform failed", { id: item.id, error })
      }
    }
    return undefined
  }

  const value: Value = {
    focused: focus,
    onFocus(handler) {
      focusHandlers.add(handler)
      return () => focusHandlers.delete(handler)
    },
    onBlur(handler) {
      blurHandlers.add(handler)
      return () => blurHandlers.delete(handler)
    },
    selection() {
      const selection = renderer.getSelection()
      if (!selection) return undefined
      return {
        text: selection.getSelectedText(),
        renderables: selection.selectedRenderables,
      }
    },
    selectionCopy: {
      transform: transformSelection,
      apply: applySelectionTransform,
      active: () => selectionTransforms().length > 0,
      copyOnSelect,
    },
    title: { decorate },
  }

  return <TerminalContext.Provider value={value}>{props.children}</TerminalContext.Provider>
}

export function useTerminal() {
  const value = useContext(TerminalContext)
  if (!value) throw new Error("TerminalProvider is missing")
  return value
}

export function useOptionalTerminal() {
  return useContext(TerminalContext)
}

/**
 * Explicit selection copy is enabled when core's copy-on-select is off, or by
 * any registered copy transform; shared by every copy-gesture call site.
 *
 * Without a provider (dialogs rendered in tests) there is no config to read, so
 * this reports core's non-Windows default of copy-on-select rather than
 * silently switching those renders to explicit copy.
 */
export function explicitSelectionCopy(terminal: ReturnType<typeof useOptionalTerminal>) {
  if (!terminal) return false
  return !terminal.selectionCopy.copyOnSelect() || terminal.selectionCopy.active()
}
