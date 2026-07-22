// Checked-out branch for the mini entry splash.
//
// Read from the repository's HEAD file rather than by running git, so the
// splash costs two syscalls and no subprocess on a path that already blocks
// the first frame. The splash is a scrollback snapshot — immutable terminal
// history once written — so this is deliberately a one-shot read with no
// watching: the line records the branch the session opened on, and a later
// checkout does not rewrite history.
import { dirname, isAbsolute, resolve } from "node:path"
import { readFileSync, statSync } from "node:fs"

// Injected so resolution can be exercised against a plain map of paths rather
// than a real repository.
export type GitFs = {
  read(path: string): string | undefined
  kind(path: string): "file" | "directory" | undefined
}

export type Head = { type: "branch"; name: string } | { type: "detached"; sha: string }

const SHA_LENGTH = 7

export const gitFs: GitFs = {
  read(path) {
    try {
      return readFileSync(path, "utf8")
    } catch {
      return undefined
    }
  },
  kind(path) {
    try {
      return statSync(path).isDirectory() ? "directory" : "file"
    } catch {
      return undefined
    }
  },
}

/**
 * Parses the one line git writes to HEAD: either a symbolic ref to the checked
 * out branch, or a raw commit sha when the checkout is detached.
 */
export function parseHead(contents: string | undefined): Head | undefined {
  const text = contents?.trim()
  if (!text) return undefined
  if (text.startsWith("ref:")) {
    const ref = text.slice(4).trim()
    if (!ref) return undefined
    // Branch refs live under refs/heads/; anything else (a tag or remote ref
    // checked out symbolically) keeps its full ref path rather than being
    // mislabeled with a bare final segment.
    return { type: "branch", name: ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref }
  }
  if (!/^[0-9a-f]{7,40}$/i.test(text)) return undefined
  return { type: "detached", sha: text }
}

/**
 * Finds the git directory governing `directory`, walking up until one is found
 * or the filesystem root is reached.
 *
 * `.git` is a directory in an ordinary clone, but a file holding a `gitdir:`
 * pointer inside a linked worktree or a submodule — and in a worktree that
 * pointer is the only place HEAD reflects the worktree's own branch, so
 * following it is what makes the line correct there rather than showing the
 * main checkout's branch.
 */
export function resolveGitDir(directory: string, fs: GitFs): string | undefined {
  let current = resolve(directory)
  for (;;) {
    const candidate = resolve(current, ".git")
    const kind = fs.kind(candidate)
    if (kind === "directory") return candidate
    if (kind === "file") {
      const pointer = fs.read(candidate)?.trim()
      const target = pointer?.startsWith("gitdir:") ? pointer.slice("gitdir:".length).trim() : undefined
      if (target) return isAbsolute(target) ? resolve(target) : resolve(current, target)
      return undefined
    }
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

export function readHead(directory: string | undefined, fs: GitFs = gitFs): Head | undefined {
  if (!directory) return undefined
  const gitDir = resolveGitDir(directory, fs)
  if (!gitDir) return undefined
  return parseHead(fs.read(resolve(gitDir, "HEAD")))
}

// Mono spells it out: the branch glyph is outside ASCII, and mono exists for
// terminals that cannot be trusted with the rest of the palette either.
export function branchLabel(head: Head | undefined, mono = false): string | undefined {
  if (!head) return undefined
  const name = head.type === "branch" ? head.name : head.sha.slice(0, SHA_LENGTH)
  return `${mono ? "on " : "⎇ "}${name}`
}

// Nothing here should be able to keep mini from painting its first frame.
export function splashBranch(directory: string | undefined, mono = false): string | undefined {
  try {
    return branchLabel(readHead(directory), mono)
  } catch {
    return undefined
  }
}
