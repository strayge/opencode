import { expect, test } from "bun:test"
import type { OpenCodeClient } from "@opencode-ai/client"
import { unqueue } from "../../src/routes/session/unqueue"

const client = (revoke: (input: { sessionID: string; inputID: string }) => Promise<unknown>) =>
  ({ session: { pending: { revoke } } }) as unknown as OpenCodeClient

const input = { sessionID: "ses_1", messageID: "msg_1" }

test("reports a dropped input as revoked", async () => {
  const calls: unknown[] = []
  const result = await unqueue(
    client(async (value) => {
      calls.push(value)
      return { id: "msg_1" }
    }),
    input,
  )
  expect(result).toEqual({ type: "revoked" })
  expect(calls).toEqual([{ sessionID: "ses_1", inputID: "msg_1" }])
})

test("reads a conflict as lost to promotion rather than as a failure", async () => {
  const result = await unqueue(
    client(() => Promise.reject({ _tag: "ConflictError", message: "no longer pending" })),
    input,
  )
  expect(result).toEqual({ type: "promoted" })
})

test("surfaces every other rejection as a failure", async () => {
  const error = new Error("connection reset")
  expect(await unqueue(client(() => Promise.reject(error)), input)).toEqual({ type: "failed", error })
})

test("does not mistake a differently tagged error for a conflict", async () => {
  const error = { _tag: "SessionNotFoundError", message: "gone" }
  expect(await unqueue(client(() => Promise.reject(error)), input)).toEqual({ type: "failed", error })
})
