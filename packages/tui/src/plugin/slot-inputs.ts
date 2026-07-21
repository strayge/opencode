import type { SessionMessageAssistant } from "@opencode-ai/client"

/**
 * Input for the session.message.assistant.footer slot. A stable object with
 * reactive getters so slot views subscribe without the object being recreated.
 * Kept out of the session route so the route edit stays a single mount line.
 */
export function assistantFooterSlotInput(sessionID: () => string, message: () => SessionMessageAssistant) {
  return {
    get sessionID() {
      return sessionID()
    },
    get messageID() {
      return message().id
    },
    get agent() {
      return message().agent
    },
    get providerID() {
      return message().model.providerID
    },
    get modelID() {
      return message().model.id
    },
    get variant() {
      return message().model.variant
    },
    get tokens() {
      return message().tokens
    },
    get cost() {
      return message().cost
    },
    get completed() {
      return Boolean(message().time.completed)
    },
    get duration() {
      const time = message().time
      const duration = time.completed ? time.completed - time.created : 0
      return duration || undefined
    },
  }
}
