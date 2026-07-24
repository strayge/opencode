import type { OpenCodeClient } from "@opencode-ai/client"
import { isRecord } from "../../util/record"

/**
 * "promoted" is the expected outcome of losing the race against the next step
 * boundary rather than a failure, so callers report it differently from a
 * transport error: nothing was cancelled, but nothing went wrong either.
 */
export type UnqueueResult = { type: "revoked" } | { type: "promoted" } | { type: "failed"; error: unknown }

/**
 * Drops one still-pending input server-side.
 *
 * Deliberately revokes exactly the input it is given. A prompt submitted with a
 * pending editor selection admits a synthetic input alongside the user one, and
 * that synthetic is left pending here — guessing which neighbouring synthetics
 * belong to a prompt would silently eat unrelated ones (a backgrounded-work
 * notice, a plugin's).
 */
export async function unqueue(
  client: OpenCodeClient,
  input: { sessionID: string; messageID: string },
): Promise<UnqueueResult> {
  try {
    await client.session.pending.revoke({ sessionID: input.sessionID, inputID: input.messageID })
    return { type: "revoked" }
  } catch (error) {
    if (isRecord(error) && error._tag === "ConflictError") return { type: "promoted" }
    return { type: "failed", error }
  }
}
