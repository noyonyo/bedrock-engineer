import { Message } from '@aws-sdk/client-bedrock-runtime'

export type CallConverseAPIProps = {
  modelId: string
  messages: Message[]
  system: [{ text: string }]
  toolConfig?: any
}

export type AWSCredentials = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  region: string
}

export interface ThinkingMode {
  enabled: boolean
  type: 'enabled'
  budget_tokens: number
}

export type InferenceParams = {
  maxTokens: number
  temperature: number
  topP?: number
  thinking?: ThinkingMode
}

export interface Store {
  get(key: 'aws'): AWSCredentials
  get(key: 'inferenceParams'): InferenceParams
  get(key: string): any
}

export type ServiceContext = {
  store: Store
}
