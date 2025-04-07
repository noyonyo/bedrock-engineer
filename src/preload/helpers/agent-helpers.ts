import { store } from '../store'
import { CustomAgent } from '../../types/agent-chat'

/**
 * Function to combine and return custom agents and shared agents
 * Note: directoryAgents are not included
 */
export function getAllAgents(): CustomAgent[] {
  const customAgents = store.get('customAgents') || []
  const sharedAgents = store.get('sharedAgents') || []
  return [...customAgents, ...sharedAgents]
}

/**
 * Function to search for an agent by ID
 * Searches through custom agents and shared agents
 */
export function findAgentById(agentId: string): CustomAgent | undefined {
  return getAllAgents().find((agent) => agent.id === agentId)
}
