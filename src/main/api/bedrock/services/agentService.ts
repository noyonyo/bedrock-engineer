import {
  BedrockAgentRuntimeClient,
  RetrieveAndGenerateCommand,
  RetrieveAndGenerateCommandInput,
  RetrieveCommand,
  RetrieveCommandInput,
  InvokeAgentCommand,
  InvokeAgentCommandInput,
  InvokeAgentCommandOutput,
  ResponseStream,
  TracePart
} from '@aws-sdk/client-bedrock-agent-runtime'
import { createAgentRuntimeClient } from '../client'
import type { ServiceContext } from '../types'

// Clearly separate required and optional parameters
type RequiredAgentParams = {
  agentId: string
  agentAliasId: string
  inputText: string
}

type OptionalAgentParams = Partial<{
  sessionId: string
  enableTrace: boolean
}>

type Completion = {
  message: string
  files: { name: string; content: Uint8Array }[]
  traces: TracePart[]
}

export type InvokeAgentResult = {
  $metadata: InvokeAgentCommandOutput['$metadata']
  contentType: InvokeAgentCommandOutput['contentType']
  sessionId: InvokeAgentCommandOutput['sessionId']
  completion?: Completion
}

// Exclude specific properties from InvokeAgentCommandInput and combine new required and optional parameters
export type InvokeAgentInput = RequiredAgentParams &
  OptionalAgentParams &
  Omit<
    InvokeAgentCommandInput,
    keyof RequiredAgentParams | keyof OptionalAgentParams | 'agentId' | 'agentAliasId' | 'sessionId'
  >

export class AgentService {
  private agentClient: BedrockAgentRuntimeClient
  constructor(private context: ServiceContext) {
    this.agentClient = createAgentRuntimeClient(this.context.store.get('aws'))
  }

  async retrieveAndGenerate(props: RetrieveAndGenerateCommandInput) {
    const command = new RetrieveAndGenerateCommand(props)
    const res = await this.agentClient.send(command)
    return res
  }

  async retrieve(props: RetrieveCommandInput) {
    const command = new RetrieveCommand(props)
    const res = await this.agentClient.send(command)
    return res
  }

  /**
   * Method to interact with Agent
   * @param params Parameters required for Agent interaction
   * @returns Response from Agent
   */
  async invokeAgent(params: InvokeAgentInput): Promise<InvokeAgentResult> {
    console.log(params)
    const { agentId, agentAliasId, sessionId, inputText, enableTrace = false, ...rest } = params

    // Generate new session ID if not specified
    const generatedSessionId = sessionId || this.generateSessionId()

    const command = new InvokeAgentCommand({
      agentId,
      agentAliasId,
      sessionId: generatedSessionId,
      inputText,
      enableTrace,
      ...rest
    })

    try {
      const response = await this.agentClient.send(command)
      console.log({ response })
      return {
        $metadata: response.$metadata,
        contentType: response.contentType,
        sessionId: response.sessionId,
        completion: response.completion
          ? await this.readStreamResponse(response.completion)
          : undefined
      }
    } catch (error) {
      console.error('Error invoking agent:', error)
      throw error
    }
  }

  // Utility function to read response from stream
  private async readStreamResponse(stream: AsyncIterable<ResponseStream>) {
    const response: Completion = {
      message: '',
      files: [],
      traces: []
    }

    try {
      const existingFiles = new Set<string>()

      for await (const streamChunk of stream) {
        if (streamChunk.trace?.trace) {
          response.traces.push(streamChunk.trace)
        }

        if (streamChunk.chunk?.bytes) {
          const text = new TextDecoder().decode(streamChunk.chunk.bytes)
          response.message += text
        }

        if (streamChunk.files) {
          for (const file of streamChunk.files.files || []) {
            // Only show first occurrence as the same file may appear multiple times
            if (existingFiles.has(file.name || '')) {
              continue
            }
            existingFiles.add(file.name || '')

            if (file.name && file.bytes) {
              response.files.push({
                name: file.name,
                content: file.bytes
              })
            }
          }
        }
      }
    } catch (error) {
      console.error('Error reading stream:', error)
      throw error
    }
    return response
  }

  /**
   * Private method to generate session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }
}
