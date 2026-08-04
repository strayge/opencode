import { Audio, type AudioErrorContext, type AudioPlayOptions, type AudioSound } from "@opentui/core"
import { readFile } from "node:fs/promises"

let audio: Audio | null | undefined
let startFailed = false
const sounds = new Map<string, Promise<AudioSound | null>>()

function getAudio() {
  if (audio !== undefined) return audio
  try {
    const next = Audio.create({ autoStart: false })
    next.on("error", (error: Error, context: AudioErrorContext) => {
      console.debug("tui audio error", { error, context })
    })
    audio = next
    return next
  } catch (error) {
    console.debug("failed to create tui audio", { error })
    audio = null
    return null
  }
}

export function loadSoundFile(file: string) {
  const current = getAudio()
  if (!current) return Promise.resolve(null)
  const cached = sounds.get(file)
  if (cached) return cached
  const task = readFile(file)
    .then((bytes) => current.loadSound(bytes))
    .catch((error) => {
      console.debug("failed to load tui sound", { file, error })
      return null
    })
  sounds.set(file, task)
  return task
}

export function play(sound: AudioSound, options?: AudioPlayOptions) {
  const current = getAudio()
  if (!current) return null
  if (!current.isStarted()) {
    // Opening the playback device is the one step that can fail once per call
    // rather than once per process, and on a host without a usable device the
    // native backend writes its own diagnostics straight to fd 2 — past the
    // renderer's console capture and onto the rendered screen. Retrying on
    // every sound repaints that damage, so the failure is remembered like a
    // failed engine creation and the device is never probed again.
    if (startFailed) return null
    if (!current.start()) {
      startFailed = true
      return null
    }
  }
  return current.play(sound, options)
}

export function dispose() {
  audio?.dispose()
  audio = undefined
  startFailed = false
  sounds.clear()
}
