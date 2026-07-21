import { createContext, createEffect, createSignal, onCleanup, onMount, useContext, type ParentProps } from "solid-js"
import { useRenderer } from "@opentui/solid"

export type TerminalFocus = "unknown" | "focused" | "blurred"

export type TerminalTitleDecoration = {
  /** Stable identifier; registering the same ID replaces the previous decoration. */
  id: string
  /** Higher priority renders closer to the base title. Defaults to 0. */
  priority?: number
  prefix?: () => string | undefined
  suffix?: () => string | undefined
}

type Value = {
  readonly focused: () => TerminalFocus
  readonly onFocus: (handler: () => void) => () => void
  readonly onBlur: (handler: () => void) => () => void
  readonly title: {
    readonly decorate: (decoration: TerminalTitleDecoration) => () => void
  }
}

const TerminalContext = createContext<Value>()

export function TerminalProvider(props: ParentProps) {
  const renderer = useRenderer()

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

