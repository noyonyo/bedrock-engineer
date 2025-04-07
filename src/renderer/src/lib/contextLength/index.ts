import { Message } from '@aws-sdk/client-bedrock-runtime'

/**
 * Function to limit the length of the context and retain important messages
 * This function retains messages that meet the following conditions:
 * 1. The latest `contextLength` number of messages
 * 2. Messages necessary to maintain pairs of ToolUse and ToolResult
 * 3. Messages containing reasoningContent
 *
 * @param messages Array of all messages
 * @param contextLength Length of context to retain
 * @returns Array of messages with limited context
 */
export function limitContextLength(messages: Message[], contextLength: number): Message[] {
  if (!contextLength || contextLength <= 0 || messages.length <= contextLength) {
    return messages
  }

  // Map to identify pairs of ToolUse and ToolResult
  const toolUseIdMap = new Map<string, boolean>()
  const toolResultIdMap = new Map<string, boolean>()

  // Collect necessary ToolUseId and ToolResultId from the latest messages
  const recentMessages = messages.slice(-contextLength)
  recentMessages.forEach((message) => {
    if (message.content) {
      message.content.forEach((block) => {
        if (block.toolUse?.toolUseId) {
          toolUseIdMap.set(block.toolUse.toolUseId, true)
        }
        if (block.toolResult?.toolUseId) {
          toolResultIdMap.set(block.toolResult.toolUseId, true)
        }
      })
    }
  })

  // Collect messages containing reasoningContent and related ToolUse IDs
  const reasoningToolIds = new Set<string>()
  messages.forEach((message) => {
    if (message.content) {
      const hasReasoning = message.content.some((block) => block.reasoningContent)
      if (hasReasoning) {
        message.content.forEach((block) => {
          if (block.toolUse?.toolUseId) {
            reasoningToolIds.add(block.toolUse.toolUseId)
          }
        })
      }
    }
  })

  // Find necessary messages from older messages
  const olderMessages = messages.slice(0, -contextLength)
  const requiredOlderMessages = olderMessages.filter((message) => {
    if (!message.content) return false

    return message.content.some((block) => {
      // reasoningContent を含むメッセージ
      if (block.reasoningContent) {
        return true
      }

      // If ToolResult corresponds to ToolUse in the latest messages or reasoningContent
      if (
        block.toolResult?.toolUseId &&
        (toolUseIdMap.has(block.toolResult.toolUseId) ||
          reasoningToolIds.has(block.toolResult.toolUseId))
      ) {
        return true
      }

      // If ToolUse corresponds to ToolResult in the latest messages
      if (block.toolUse?.toolUseId && toolResultIdMap.has(block.toolUse.toolUseId)) {
        return true
      }

      // ToolUse related to reasoningContent
      if (block.toolUse?.toolUseId && reasoningToolIds.has(block.toolUse.toolUseId)) {
        return true
      }

      return false
    })
  })

  // Combine necessary messages and latest messages
  return [...requiredOlderMessages, ...recentMessages]
}
