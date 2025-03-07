import { Message } from '@aws-sdk/client-bedrock-runtime'
import type { AwsCredentialIdentity } from "@smithy/types";

export type CallConverseAPIProps = {
  modelId: string
  messages: Message[]
  system: [{ text: string }]
  toolConfig?: any
}

export type AWSCredentials = {
  credentials: AwsCredentialIdentity;
  region: string;
}

export type InferenceParams = {
  maxTokens: number
  temperature: number
  topP: number
}

export interface Store {
  get(key: 'aws'): AWSCredentials
  get(key: 'inferenceParams'): InferenceParams
  get(key: string): any
}

export type ServiceContext = {
  store: Store
}
