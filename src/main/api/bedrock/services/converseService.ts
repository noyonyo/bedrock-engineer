import {
  ContentBlock,
  ConverseCommand,
  ConverseCommandInput,
  ConverseCommandOutput,
  ConverseStreamCommand,
  ConverseStreamCommandInput,
  ConverseStreamCommandOutput,
  Message
} from '@aws-sdk/client-bedrock-runtime'
import { createRuntimeClient } from '../client'
import { processImageContent } from '../utils/imageUtils'
import { getAlternateRegionOnThrottling } from '../utils/awsUtils'
import type { CallConverseAPIProps, ServiceContext } from '../types'
import { createCategoryLogger } from '../../../../common/logger'

// Create category logger for converse service
const converseLogger = createCategoryLogger('bedrock:converse')

/**
 * Service class for interacting with Bedrock Converse API
 * Handles request preprocessing and error handling
 */
export class ConverseService {
  private static readonly MAX_RETRIES = 30
  private static readonly RETRY_DELAY = 5000

  constructor(private context: ServiceContext) {}

  /**
   * Call non-streaming Converse API
   */
  async converse(props: CallConverseAPIProps, retries = 0): Promise<ConverseCommandOutput> {
    try {
      // Prepare request parameters
      const { commandParams } = await this.prepareCommandParameters(props)
      const runtimeClient = createRuntimeClient(this.context.store.get('aws'))
      const awsConfig = this.context.store.get('aws')

      // Log output before API request
      converseLogger.debug('Sending converse request', {
        modelId: props.modelId,
        region: awsConfig.region,
        messageCount: props.messages.length
      })

      // Send API request
      const command = new ConverseCommand(commandParams)
      return await runtimeClient.send(command)
    } catch (error: any) {
      return this.handleError(error, props, retries, 'converse', ConverseCommand)
    }
  }

  /**
   * Call ConverseAPI in streaming format
   * @param input ConverseAPI input parameters
   * @returns Streaming response
   */
  async converseStream(
    props: CallConverseAPIProps,
    retries = 0
  ): Promise<ConverseStreamCommandOutput> {
    try {
      // Prepare request parameters
      const { commandParams } = await this.prepareCommandParameters(props)
      const runtimeClient = createRuntimeClient(this.context.store.get('aws'))
      const awsConfig = this.context.store.get('aws')

      // Log before API request
      converseLogger.debug('Sending stream converse request', {
        modelId: props.modelId,
        region: awsConfig.region,
        messageCount: props.messages.length
      })

      // Send API request
      const command = new ConverseStreamCommand(commandParams)
      return await runtimeClient.send(command)
    } catch (error: any) {
      return this.handleError(error, props, retries, 'converseStream', ConverseStreamCommand)
    }
  }

  /**
   * Prepare parameters for API request
   * Process messages and create command parameters
   */
  private async prepareCommandParameters(props: CallConverseAPIProps): Promise<{
    commandParams: ConverseCommandInput | ConverseStreamCommandInput
    processedMessages?: Message[]
  }> {
    const { modelId, messages, system, toolConfig, guardrailConfig } = props

    // Process messages
    const processedMessages = this.processMessages(messages)

    // Debug: Check empty text fields
    this.logEmptyTextFields(processedMessages)

    // Normalize messages
    const sanitizedMessages = this.normalizeMessages(processedMessages)

    // Get inference parameters
    const inferenceParams = this.context.store.get('inferenceParams')

    const thinkingMode = this.context.store.get('thinkingMode')

    // If Claude 3.7 Sonnet is used and Thinking Mode is enabled, add additionalModelRequestFields
    let additionalModelRequestFields: Record<string, any> | undefined = undefined

    // If modelId is Claude 3.7 Sonnet and thinkingMode is enabled, set additionalModelRequestFields
    if (modelId.includes('anthropic.claude-3-7-sonnet') && thinkingMode?.type === 'enabled') {
      additionalModelRequestFields = {
        thinking: {
          type: thinkingMode.type,
          budget_tokens: thinkingMode.budget_tokens
        }
      }
      inferenceParams.topP = undefined // reasoning does not require topP
      inferenceParams.temperature = 1 // reasoning requires temperature to be 1

      // Special log output for enabled Thinking Mode
      converseLogger.debug('Enabling Thinking Mode', {
        modelId,
        thinkingType: thinkingMode.type,
        budgetTokens: thinkingMode.budget_tokens,
        messageCount: messages.length,
        assistantMessages: messages.filter((m) => m.role === 'assistant').length
      })
    }

    if (modelId.includes('nova')) {
      // https://docs.aws.amazon.com/nova/latest/userguide/tool-use-definition.html
      // For tool calling, the inference parameters should be set as inf_params = {"topP": 1, "temperature": 1} and additionalModelRequestFields= {"inferenceConfig": {"topK":1}}. This is because we encourage greedy decoding parameters for Amazon Nova tool calling.
      additionalModelRequestFields = {
        inferenceConfig: { topK: 1 }
      }
      inferenceParams.topP = 1
      inferenceParams.temperature = 1
    }

    // Create command parameters
    const commandParams: ConverseCommandInput | ConverseStreamCommandInput = {
      modelId,
      messages: sanitizedMessages,
      system,
      toolConfig,
      inferenceConfig: inferenceParams,
      additionalModelRequestFields
    }

    // If guardrailConfig is provided or enabled from settings, add
    if (guardrailConfig) {
      commandParams.guardrailConfig = guardrailConfig
      converseLogger.debug('Using provided guardrail', {
        guardrailId: guardrailConfig.guardrailIdentifier,
        guardrailVersion: guardrailConfig.guardrailVersion
      })
    } else {
      // Get guardrail settings from settings
      const storedGuardrailSettings = this.context.store.get('guardrailSettings')
      if (storedGuardrailSettings?.enabled && storedGuardrailSettings.guardrailIdentifier) {
        commandParams.guardrailConfig = {
          guardrailIdentifier: storedGuardrailSettings.guardrailIdentifier,
          guardrailVersion: storedGuardrailSettings.guardrailVersion,
          trace: storedGuardrailSettings.trace
        }
        converseLogger.debug('Using guardrail from settings', {
          guardrailId: storedGuardrailSettings.guardrailIdentifier,
          guardrailVersion: storedGuardrailSettings.guardrailVersion
        })
      }
    }

    return { commandParams, processedMessages }
  }

  /**
   * Process messages and convert image data to the correct format
   */
  private processMessages(messages: Message[]): Message[] {
    return messages.map((msg) => ({
      ...msg,
      content: Array.isArray(msg.content) ? processImageContent(msg.content) : msg.content
    }))
  }

  /**
   * Log messages with empty text fields
   */
  private logEmptyTextFields(messages: Message[]): void {
    const emptyTextFieldMsgs = messages.filter(
      (msg) =>
        Array.isArray(msg.content) &&
        msg.content.some(
          (block) =>
            Object.prototype.hasOwnProperty.call(block, 'text') &&
            (!block.text || !block.text.trim())
        )
    )

    if (emptyTextFieldMsgs.length > 0) {
      converseLogger.debug('Found empty text fields in content blocks before sanitization', {
        emptyTextFieldMsgs: JSON.stringify(emptyTextFieldMsgs),
        count: emptyTextFieldMsgs.length
      })
    }
  }

  /**
   * Ensure content blocks have non-empty text fields
   */
  private sanitizeContentBlocks(content: ContentBlock[] | unknown): ContentBlock[] | undefined {
    if (!Array.isArray(content)) {
      return undefined
    }

    return content.map((block) => {
      // If text field is empty or effectively empty (only spaces or newlines)
      if (
        Object.prototype.hasOwnProperty.call(block, 'text') &&
        (block.text === '' || !block.text?.trim())
      ) {
        // Set text field to a single space placeholder
        block.text = ' '
      }

      // If toolUse block input is empty string, convert to empty JSON object
      if (
        Object.prototype.hasOwnProperty.call(block, 'toolUse') &&
        block.toolUse &&
        Object.prototype.hasOwnProperty.call(block.toolUse, 'input') &&
        block.toolUse.input === ''
      ) {
        // Replace empty string with empty JSON object
        block.toolUse.input = {}
        converseLogger.debug(
          'Empty toolUse.input converted to empty JSON object in sanitizeContentBlocks',
          {
            toolName: block.toolUse.name
          }
        )
      }

      return block
    }) as ContentBlock[]
  }

  /**
   * Normalize each content block in messages
   */
  private normalizeMessages(messages: Message[]): Message[] {
    return messages.map((message) => {
      if (message.content) {
        // If content is an array, remove empty text blocks and sanitize
        if (Array.isArray(message.content)) {
          // Filter out empty content blocks
          const validBlocks = message.content.filter((block) => {
            // Filter out text blocks that are effectively empty
            if (
              Object.prototype.hasOwnProperty.call(block, 'text') &&
              (!block.text || !block.text.trim())
            ) {
              // Keep other block types
              return Object.keys(block).length > 1
            }
            return true
          })

          // If all blocks are filtered out, keep at least one valid block
          if (validBlocks.length === 0) {
            message.content = [{ text: ' ' }]
          } else {
            // Sanitize remaining blocks
            message.content = this.sanitizeContentBlocks(validBlocks)
          }
        } else {
          message.content = this.sanitizeContentBlocks(message.content)
        }
      }
      return message
    })
  }

  /**
   * Handle errors
   */
  private async handleError<T extends ConverseCommandOutput | ConverseStreamCommandOutput>(
    error: any,
    props: CallConverseAPIProps,
    retries: number,
    methodName: 'converse' | 'converseStream',
    CommandClass: typeof ConverseCommand | typeof ConverseStreamCommand
  ): Promise<T> {
    // If throttling or service unavailable
    if (error.name === 'ThrottlingException' || error.name === 'ServiceUnavailableException') {
      converseLogger.warn(`${error.name} occurred - retrying`, {
        retry: retries,
        errorName: error.name,
        message: error.message,
        modelId: props.modelId,
        method: methodName
      })

      // If maximum retries reached, throw error
      if (retries >= ConverseService.MAX_RETRIES) {
        converseLogger.error('Maximum retries reached for Bedrock API request', {
          maxRetries: ConverseService.MAX_RETRIES,
          errorName: error.name,
          modelId: props.modelId,
          method: methodName
        })
        throw error
      }

      // If throttling, try execution in another region
      if (error.name === 'ThrottlingException') {
        const alternateResult = await this.tryAlternateRegion(props, error, CommandClass)
        if (alternateResult) {
          return alternateResult as T
        }
      }

      // Wait and retry
      await new Promise((resolve) => setTimeout(resolve, ConverseService.RETRY_DELAY))
      return methodName === 'converse'
        ? ((await this.converse(props, retries + 1)) as T)
        : ((await this.converseStream(props, retries + 1)) as T)
    }

    // If validation error
    if (error.name === 'ValidationException') {
      // Other validation errors
      converseLogger.error(`ValidationException in ${methodName}`, {
        errorMessage: error.message,
        errorDetails: error.$metadata,
        modelId: props.modelId
      })
    } else {
      // Other errors
      converseLogger.error(`Error in ${methodName}`, {
        errorName: error.name,
        errorMessage: error.message,
        modelId: props.modelId,
        stack: error.stack
      })
    }

    throw error
  }

  /**
   * Try executing API call in another region
   */
  private async tryAlternateRegion<T extends ConverseCommandOutput | ConverseStreamCommandOutput>(
    props: CallConverseAPIProps,
    _error: any,
    CommandClass: typeof ConverseCommand | typeof ConverseStreamCommand
  ): Promise<T | null> {
    const awsConfig = this.context.store.get('aws')
    const bedrockSettings = this.context.store.get('bedrockSettings')

    if (!bedrockSettings?.enableRegionFailover) {
      return null
    }

    const availableRegions = bedrockSettings.availableFailoverRegions || []
    const alternateRegion = getAlternateRegionOnThrottling(
      awsConfig.region,
      props.modelId,
      availableRegions
    )

    // Skip if alternate region is the same as the current region
    if (alternateRegion === awsConfig.region) {
      return null
    }

    converseLogger.info('Switching to alternate region due to throttling', {
      currentRegion: awsConfig.region,
      alternateRegion,
      modelId: props.modelId
    })

    try {
      // Create client for another region
      const alternateClient = createRuntimeClient({
        ...awsConfig,
        region: alternateRegion
      })

      // Re-create request parameters
      const { commandParams } = await this.prepareCommandParameters(props)

      // Create appropriate instance based on command class
      if (CommandClass === ConverseCommand) {
        const command = new ConverseCommand(commandParams)
        return (await alternateClient.send(command)) as T
      } else {
        const command = new ConverseStreamCommand(commandParams)
        return (await alternateClient.send(command)) as T
      }
    } catch (alternateError: any) {
      converseLogger.error('Error in alternate region request', {
        region: alternateRegion,
        modelId: props.modelId,
        errorName: alternateError?.name,
        errorMessage: alternateError?.message,
        stack: alternateError?.stack
      })
      return null // If error in alternate region, return null for normal retry
    }
  }
}
