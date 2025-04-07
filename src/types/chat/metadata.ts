/**
 * Function to generate message ID and metadata ID
 */
export const generateMessageId = (): string =>
  `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
