import Store from 'electron-store'
import { LLM, InferenceParameters, ThinkingMode, ThinkingModeBudget } from '../types/llm'
import { AgentChatConfig, KnowledgeBase, SendMsgKey, ToolState } from '../types/agent-chat'
import { CustomAgent } from '../types/agent-chat'
import { BedrockAgent } from '../types/agent'
import { AWSCredentials } from '../main/api/bedrock/types'

const DEFAULT_SHELL = '/bin/bash'
const DEFAULT_INFERENCE_PARAMS: InferenceParameters = {
  maxTokens: 4096,
  temperature: 0.5,
  topP: 0.9
}
const DEFAULT_THINKING_MODE = {
  type: 'enabled',
  budget_tokens: ThinkingModeBudget.NORMAL
}

const DEFAULT_BEDROCK_SETTINGS = {
  enableRegionFailover: false,
  availableFailoverRegions: []
}

const DEFAULT_GUARDRAIL_SETTINGS = {
  enabled: false,
  guardrailIdentifier: '',
  guardrailVersion: 'DRAFT',
  trace: 'enabled'
}

type StoreScheme = {
  /** Path where Electron application user data is stored */
  userDataPath?: string

  /** Path of the currently selected project (working directory) */
  projectPath?: string

  /** Settings for the currently selected language model (LLM) */
  llm?: LLM

  /** Inference parameters for the language model (temperature, max tokens, etc.) */
  inferenceParams: InferenceParameters

  /** Thinking mode settings (for Claude 3.7 Sonnet) */
  thinkingMode?: ThinkingMode

  /** Application display language setting (Japanese or English) */
  language: 'ja' | 'en'

  /** Agent chat configuration (ignored files list, context length, etc.) */
  agentChatConfig: AgentChatConfig

  /** State and settings of available tools (enabled/disabled, configuration) */
  tools: ToolState[]

  /** Website generator feature settings */
  websiteGenerator?: {
    /** List of knowledge bases to use */
    knowledgeBases?: KnowledgeBase[]
    /** Whether to enable knowledge base feature */
    enableKnowledgeBase?: boolean
    /** Whether to enable search feature */
    enableSearch?: boolean
  }

  /** Tavily search API settings */
  tavilySearch: {
    /** API key for Tavily search API */
    apikey: string
  }

  /** Backend API endpoint URL */
  apiEndpoint: string

  /** Advanced setting options */
  advancedSetting: {
    /** Keyboard shortcut settings */
    keybinding: {
      /** Message send key setting (Enter or Cmd+Enter) */
      sendMsgKey: SendMsgKey
    }
  }

  /** AWS credentials and region settings */
  aws: AWSCredentials

  /** List of custom agents created by the user */
  customAgents: CustomAgent[]

  /** ID of the currently selected agent */
  selectedAgentId: string

  /** List of available knowledge bases */
  knowledgeBases: KnowledgeBase[]

  /** Command execution settings (shell configuration) */
  shell: string

  /** Notification feature enable/disable setting */
  notification?: boolean

  /** Amazon Bedrock specific settings */
  bedrockSettings?: {
    /** Enable/disable region failover feature */
    enableRegionFailover: boolean
    /** List of available regions for failover */
    availableFailoverRegions: string[]
  }

  /** Guardrail settings */
  guardrailSettings?: {
    /** Whether to enable guardrail */
    enabled: boolean
    /** Guardrail ID */
    guardrailIdentifier: string
    /** Guardrail version */
    guardrailVersion: string
    /** Guardrail trace settings */
    trace: 'enabled' | 'disabled'
  }

  /** List of available Amazon Bedrock agents */
  bedrockAgents?: BedrockAgent[]

  /** List of shared agents loaded from YAML format */
  sharedAgents?: CustomAgent[]
}

const electronStore = new Store<StoreScheme>()
console.log('store path', electronStore.path)

const init = () => {
  // Initialize userDataPath if not present
  const userDataPath = electronStore.get('userDataPath')
  if (!userDataPath) {
    // This will be set from main process
    electronStore.set('userDataPath', '')
  }

  const pjPath = electronStore.get('projectPath')
  if (!pjPath) {
    const defaultProjectPath = process.env[process.platform == 'win32' ? 'USERPROFILE' : 'HOME']
    electronStore.set('projectPath', defaultProjectPath)
  }

  const keybinding = electronStore.get('advancedSetting')?.keybinding
  if (!keybinding) {
    electronStore.set('advancedSetting', {
      keybinding: {
        sendMsgKey: 'Enter'
      }
    })
  }

  const language = electronStore.get('language')
  if (language === undefined) {
    electronStore.set('language', 'en')
  }

  // Initialize AWS settings if not present
  const awsConfig = electronStore.get('aws')
  if (!awsConfig) {
    electronStore.set('aws', {
      region: 'us-west-2',
      accessKeyId: '',
      secretAccessKey: ''
    })
  }

  // Initialize inference parameters if not present
  const inferenceParams = electronStore.get('inferenceParams')
  if (!inferenceParams) {
    electronStore.set('inferenceParams', DEFAULT_INFERENCE_PARAMS)
  }

  // Initialize thinking mode
  const thinkingMode = electronStore.get('thinkingMode')
  if (!thinkingMode) {
    electronStore.set('thinkingMode', DEFAULT_THINKING_MODE)
  }

  // Initialize custom agents if not present
  const customAgents = electronStore.get('customAgents')
  if (!customAgents) {
    electronStore.set('customAgents', [])
  }

  // Initialize selected agent id if not present
  const selectedAgentId = electronStore.get('selectedAgentId')
  if (!selectedAgentId) {
    electronStore.set('selectedAgentId', 'softwareAgent')
  }

  // Initialize knowledge bases
  const knowledgeBases = electronStore.get('knowledgeBases')
  if (!knowledgeBases) {
    electronStore.set('knowledgeBases', [])
  }

  // Initialize command settings if not present
  const shell = electronStore.get('shell')
  if (!shell) {
    electronStore.set('shell', DEFAULT_SHELL)
  }

  // Initialize bedrockSettings
  const bedrockSettings = electronStore.get('bedrockSettings')
  if (!bedrockSettings) {
    electronStore.set('bedrockSettings', DEFAULT_BEDROCK_SETTINGS)
  }

  // Initialize guardrailSettings
  const guardrailSettings = electronStore.get('guardrailSettings')
  if (!guardrailSettings) {
    electronStore.set('guardrailSettings', DEFAULT_GUARDRAIL_SETTINGS)
  }
}

init()

type Key = keyof StoreScheme
export const store = {
  get<T extends Key>(key: T) {
    return electronStore.get(key)
  },
  set<T extends Key>(key: T, value: StoreScheme[T]) {
    return electronStore.set(key, value)
  }
}

export type ConfigStore = typeof store
