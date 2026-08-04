import { mkdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { expect, test } from "bun:test"
import { resolveLocal } from "../src/plugin/context"
import { tmpdir } from "./fixture/fixture"

/**
 * A resolved local entrypoint has to be readable as a path, not only importable.
 * The plugin loader stats it for an mtime cache-buster before importing, so a
 * specifier the module loader could resolve on its own — `<dir>/tui`, extension
 * left to the loader — throws ENOENT there instead of loading the plugin.
 */
async function resolve(directory: string) {
  const entrypoint = await resolveLocal(pathToFileURL(directory))
  if (!entrypoint) return undefined
  // The read that fails on a loader-only specifier.
  await stat(new URL(entrypoint))
  return entrypoint
}

test("resolves a directory plugin to a file that can be stat'd, not just imported", async () => {
  await using tmp = await tmpdir()
  const directory = path.join(tmp.path, "plugin")
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, "tui.ts"), "export default {}")

  expect(await resolve(directory)).toBe(pathToFileURL(path.join(directory, "tui.ts")).href)
})

test("resolves a directory plugin whose entrypoint is an index file", async () => {
  await using tmp = await tmpdir()
  const directory = path.join(tmp.path, "plugin")
  await mkdir(path.join(directory, "tui"), { recursive: true })
  await writeFile(path.join(directory, "tui", "index.tsx"), "export default {}")

  expect(await resolve(directory)).toBe(pathToFileURL(path.join(directory, "tui", "index.tsx")).href)
})

test("prefers the TypeScript entrypoint over a built sibling", async () => {
  await using tmp = await tmpdir()
  const directory = path.join(tmp.path, "plugin")
  await mkdir(directory, { recursive: true })
  await Promise.all([
    writeFile(path.join(directory, "tui.js"), "export default {}"),
    writeFile(path.join(directory, "tui.ts"), "export default {}"),
  ])

  expect(await resolve(directory)).toBe(pathToFileURL(path.join(directory, "tui.ts")).href)
})

test("reports a directory with no TUI half as unsupported rather than failing", async () => {
  await using tmp = await tmpdir()
  const directory = path.join(tmp.path, "plugin")
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, "index.ts"), "export default {}")

  expect(await resolveLocal(pathToFileURL(directory))).toBeUndefined()
})

test("passes a file entrypoint through untouched", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "plugin.ts")
  await writeFile(file, "export default {}")

  expect(await resolve(file)).toBe(pathToFileURL(file).href)
})
