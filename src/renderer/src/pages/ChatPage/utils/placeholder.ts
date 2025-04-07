// Use custom type definitions

import { CommandConfig } from '@/types/agent-chat'
import { BedrockAgent } from '@/types/agent'
import { KnowledgeBase } from 'src/types/agent-chat'

type PlaceHolders = {
  projectPath: string
  allowedCommands?: CommandConfig[]
  knowledgeBases?: KnowledgeBase[]
  bedrockAgents?: BedrockAgent[]
}

export const replacePlaceholders = (text: string, placeholders: PlaceHolders) => {
  const {
    projectPath,
    allowedCommands = [],
    knowledgeBases = [],
    bedrockAgents = []
  } = placeholders
  const yyyyMMdd = new Date().toISOString().slice(0, 10)
  return text
    .replace(/{{projectPath}}/g, projectPath)
    .replace(/{{date}}/g, yyyyMMdd)
    .replace(/{{allowedCommands}}/g, JSON.stringify(allowedCommands))
    .replace(/{{knowledgeBases}}/g, JSON.stringify(knowledgeBases))
    .replace(/{{bedrockAgents}}/g, JSON.stringify(bedrockAgents))
}
