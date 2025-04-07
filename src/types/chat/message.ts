import {
  Message as BedrockMessage,
  ConverseStreamMetadataEvent
} from '@aws-sdk/client-bedrock-runtime'

/**
 * Message type with ID
 * Extends AWS Bedrock message type to add message ID and metadata
 */
export interface IdentifiableMessage extends BedrockMessage {
  id?: string
  status?: 'idle' | 'streaming' | 'complete' | 'error'
  metadata?: {
    converseMetadata?: ConverseStreamMetadataEvent | Record<string, any>
    // Other metadata types can be added in the future
  }
}
