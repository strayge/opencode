import { createMemo } from "solid-js"
import { useData } from "../../context/data"
import { DialogSelect } from "../../ui/dialog-select"
import type { DialogContext } from "../../ui/dialog"
import { useClipboard } from "../../context/clipboard"
import { useToast } from "../../ui/toast"
import { useClient } from "../../context/client"
import { errorMessage } from "../../util/error"
import { DialogFork } from "./dialog-fork"
import type { PromptInfo } from "../../prompt/history"
import { projectedPromptInput } from "../../prompt/codec"
import { unqueue } from "./unqueue"

export function DialogMessage(props: {
  messageID: string
  sessionID: string
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const data = useData()
  const clipboard = useClipboard()
  const toast = useToast()
  const client = useClient()
  const message = createMemo(() => data.session.message.get(props.sessionID, props.messageID))
  // Only an unpromoted input can be unsent; once the runner has it, "Revert" is
  // the action that applies.
  const pending = createMemo(() => data.session.input.has(props.sessionID, props.messageID))

  return (
    <DialogSelect
      title="Message Actions"
      options={[
        // Unsend leads while it is available: it is the only option here with a
        // deadline, since the runner can promote the input out from under it.
        ...(pending()
          ? [
              {
                title: "Unsend",
                value: "session.unqueue",
                description: "drop before the model sees it",
                onSelect: async (dialog: DialogContext) => {
                  const value = message()
                  const result = await unqueue(client.api, { sessionID: props.sessionID, messageID: props.messageID })
                  if (result.type === "revoked" && value?.type === "user")
                    props.setPrompt?.({ ...projectedPromptInput(value), pasted: [] })
                  if (result.type === "promoted")
                    toast.show({ message: "Already sent", variant: "warning", duration: 3000 })
                  if (result.type === "failed")
                    toast.show({ message: errorMessage(result.error), variant: "error", duration: 5000 })
                  dialog.clear()
                },
              },
            ]
          : []),
        {
          title: "Jump to",
          value: "message.jump",
          description: "view message in session",
          onSelect: (dialog) => dialog.clear(),
        },
        {
          title: "Revert",
          value: "session.revert",
          description: "undo messages and file changes",
          onSelect: (dialog) => {
            const value = message()
            if (value?.type === "user") {
              props.setPrompt?.({
                ...projectedPromptInput(value),
                pasted: [],
              })
            }
            void client.api.session.revert
              .stage({ sessionID: props.sessionID, messageID: props.messageID })
              .catch((error) => toast.show({ message: errorMessage(error), variant: "error", duration: 5000 }))
            dialog.clear()
          },
        },
        {
          title: "Copy",
          value: "message.copy",
          description: "message text to clipboard",
          onSelect: async (dialog) => {
            const value = message()
            if (!value) return
            const text =
              value.type === "user"
                ? value.text
                : value.type === "assistant"
                  ? value.content
                      .filter((content) => content.type === "text")
                      .map((content) => content.text)
                      .join("\n")
                  : "text" in value
                    ? value.text
                    : ""
            await clipboard.write?.(text)
            dialog.clear()
          },
        },
        {
          title: "Fork",
          value: "session.fork",
          description: "create a new session",
          onSelect: (dialog) => {
            const value = message()
            if (!value || value.type !== "user") return
            dialog.replace(() => <DialogFork sessionID={props.sessionID} messageID={props.messageID} />)
          },
        },
      ]}
    />
  )
}
