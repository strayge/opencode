import { afterEach, expect, test } from "bun:test"
import { createTestRenderer, type TestRenderer } from "@opentui/core/testing"
import { branchLabel, parseHead, readHead, resolveGitDir, splashBranch, type GitFs } from "../../src/mini/git-branch"
import { entrySplash } from "../../src/mini/splash"
import { RUN_THEME_FALLBACK } from "../../src/mini/theme"

const decoder = new TextDecoder()
const active: TestRenderer[] = []

afterEach(() => {
  for (const renderer of active.splice(0)) {
    renderer.destroy()
  }
})

function fs(files: Record<string, string>, directories: string[] = []): GitFs {
  return {
    read: (path) => files[path],
    kind: (path) => (directories.includes(path) ? "directory" : path in files ? "file" : undefined),
  }
}

test("HEAD holding a symbolic ref names the branch", () => {
  expect(parseHead("ref: refs/heads/main\n")).toEqual({ type: "branch", name: "main" })
  expect(parseHead("ref: refs/heads/feature/nested/name")).toEqual({
    type: "branch",
    name: "feature/nested/name",
  })
})

test("a symbolically checked out non-branch keeps its full ref path", () => {
  // Bare "v1.2.3" would read as a branch that does not exist.
  expect(parseHead("ref: refs/tags/v1.2.3")).toEqual({ type: "branch", name: "refs/tags/v1.2.3" })
})

test("HEAD holding a raw sha is a detached checkout", () => {
  expect(parseHead("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0")).toEqual({
    type: "detached",
    sha: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
  })
})

test("junk in HEAD names nothing rather than guessing", () => {
  expect(parseHead(undefined)).toBeUndefined()
  expect(parseHead("")).toBeUndefined()
  expect(parseHead("   \n ")).toBeUndefined()
  expect(parseHead("ref:")).toBeUndefined()
  expect(parseHead("not-a-sha")).toBeUndefined()
  expect(parseHead("abc")).toBeUndefined()
})

test("the git directory is found by walking up from the working directory", () => {
  const tree = fs({}, ["/repo/.git"])

  expect(resolveGitDir("/repo", tree)).toBe("/repo/.git")
  expect(resolveGitDir("/repo/packages/tui/src", tree)).toBe("/repo/.git")
  expect(resolveGitDir("/elsewhere", tree)).toBeUndefined()
})

test("a worktree follows its gitdir pointer, so it reports its own branch", () => {
  const tree = fs({
    "/work/.git": "gitdir: /repo/.git/worktrees/feature\n",
    "/repo/.git/worktrees/feature/HEAD": "ref: refs/heads/feature\n",
  })

  expect(resolveGitDir("/work", tree)).toBe("/repo/.git/worktrees/feature")
  // Not the main checkout's branch, which is the whole point of following it.
  expect(readHead("/work", tree)).toEqual({ type: "branch", name: "feature" })
})

test("a relative gitdir pointer resolves against the file holding it", () => {
  const tree = fs({
    "/repo/sub/.git": "gitdir: ../.git/modules/sub",
    "/repo/.git/modules/sub/HEAD": "ref: refs/heads/sub-main",
  })

  expect(readHead("/repo/sub", tree)).toEqual({ type: "branch", name: "sub-main" })
})

test("an unreadable or pointerless git file yields nothing", () => {
  expect(resolveGitDir("/repo", fs({ "/repo/.git": "not a pointer" }))).toBeUndefined()
  expect(readHead(undefined, fs({}))).toBeUndefined()
})

test("labels mark the branch, abbreviate a detached sha, and spell it out in mono", () => {
  expect(branchLabel({ type: "branch", name: "custom" })).toBe("⎇ custom")
  expect(branchLabel({ type: "branch", name: "custom" }, true)).toBe("on custom")
  expect(branchLabel({ type: "detached", sha: "a1b2c3d4e5f6a7b8c9d0" })).toBe("⎇ a1b2c3d")
  expect(branchLabel(undefined)).toBeUndefined()
})

test("reading a directory that is not a repository never throws", () => {
  expect(splashBranch("/definitely/not/a/repository")).toBeUndefined()
  expect(splashBranch(undefined)).toBeUndefined()
})

const WIDTH = 60

// Drives the real scrollback path: the writer is handed to the renderer and
// the committed snapshot is read back, the same way splash output reaches a
// terminal.
async function splashRows(input: { detail?: string; branch?: string; mono?: boolean }) {
  const out = await createTestRenderer({
    width: WIDTH,
    screenMode: "split-footer",
    footerHeight: 6,
    externalOutputMode: "capture-stdout",
    consoleMode: "disabled",
  })
  active.push(out.renderer)

  out.renderer.writeToScrollback(
    entrySplash({
      title: "Session",
      session_id: "ses_1",
      theme: RUN_THEME_FALLBACK.splash,
      detail: input.detail,
      branch: input.branch,
      mono: input.mono,
    }),
  )

  const queue = Reflect.get(out.renderer, "externalOutputQueue") as { claim(): unknown[] }
  const commit = queue.claim()[0] as {
    snapshot: { height: number; getRealCharBytes(addLineBreaks?: boolean): Uint8Array; destroy(): void }
  }
  const raw = decoder.decode(commit.snapshot.getRealCharBytes())
  const rows = Array.from({ length: commit.snapshot.height }, (_, index) =>
    raw.slice(index * WIDTH, (index + 1) * WIDTH).trimEnd(),
  )
  const height = commit.snapshot.height
  commit.snapshot.destroy()
  return { height, rows }
}

test("the branch renders directly under the directory", async () => {
  const splash = await splashRows({ detail: "~/apps/opencode", branch: "⎇ custom" })

  const directory = splash.rows.findIndex((row) => row.includes("~/apps/opencode"))
  const branch = splash.rows.findIndex((row) => row.includes("custom"))

  expect(directory).toBeGreaterThan(-1)
  expect(branch).toBe(directory + 1)
  // Aligned with the directory rather than indented under it.
  expect(splash.rows[branch]?.indexOf("⎇")).toBe(splash.rows[directory]?.indexOf("~"))
  // The logo is three rows, so a third body row still fits inside it.
  expect(splash.height).toBe(4)
})

test("mono grows the splash for the branch, having only a one-row mark", async () => {
  const withBranch = await splashRows({ detail: "~/apps/opencode", branch: "on custom", mono: true })
  const withoutBranch = await splashRows({ detail: "~/apps/opencode", mono: true })

  expect(withoutBranch.height).toBe(3)
  expect(withBranch.height).toBe(4)
  expect(withBranch.rows.at(-1)).toContain("on custom")
})

test("a splash with no branch is unchanged", async () => {
  const splash = await splashRows({ detail: "~/apps/opencode" })

  expect(splash.height).toBe(4)
  expect(splash.rows.some((row) => row.includes("⎇"))).toBe(false)
})

test("a branch with no directory to sit under is not rendered alone", async () => {
  const orphan = await splashRows({ branch: "⎇ custom" })

  expect(orphan.rows.some((row) => row.includes("custom"))).toBe(false)
})
