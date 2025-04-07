import { z } from 'zod'
import { MCPClient } from './mcp-client'
import { Tool } from '@aws-sdk/client-bedrock-runtime'
import { McpServerConfig } from '../../types/agent-chat'

const configSchema = z.object({
  mcpServers: z.record(
    z.string(),
    z.object({
      command: z.string(),
      args: z.array(z.string()),
      env: z.record(z.string(), z.string()).optional()
    })
  )
})

let clients: { name: string; client: MCPClient }[] = []

// Cache variable
let lastMcpServerConfigHash: string | null = null
let lastMcpServerLength: number = 0
let lastMcpServerNames: string[] = []
let initializationInProgress: Promise<void> | null = null

/**
 * Generate a stable hash value for server configuration comparison
 * Consider only essential parts of the configuration and exclude unnecessary variable elements
 */
const generateConfigHash = (servers: McpServerConfig[]): string => {
  if (!servers || servers.length === 0) {
    return 'empty'
  }

  // Sort by name for stable order
  const sortedServers = [...servers].sort((a, b) => a.name.localeCompare(b.name))

  // Create an array of objects containing only essential settings
  const essentialConfigs = sortedServers.map((server) => ({
    name: server.name,
    command: server.command,
    args: [...server.args], // Copy array to stabilize
    // Include env if it exists and is not empty
    ...(server.env && Object.keys(server.env).length > 0 ? { env: { ...server.env } } : {})
  }))

  return JSON.stringify(essentialConfigs)
}

/**
 * Check if server configuration has substantially changed
 * Verify both the name list and configuration hash
 */
const hasConfigChanged = (servers: McpServerConfig[] = []): boolean => {
  // If server count changes, it's definitely changed
  if (servers.length !== lastMcpServerLength) {
    console.log(`MCP server count changed: ${lastMcpServerLength} -> ${servers.length}`)
    return true
  }

  // If empty list, consider it unchanged
  if (servers.length === 0 && lastMcpServerLength === 0) {
    return false
  }

  // Create a list of server names and compare
  const currentNames = servers.map((s) => s.name).sort()
  const sameNames =
    currentNames.length === lastMcpServerNames.length &&
    currentNames.every((name, i) => name === lastMcpServerNames[i])

  if (!sameNames) {
    console.log(`MCP server names changed`)
    return true
  }

  // Compare detailed configuration hash
  const configHash = generateConfigHash(servers)
  return configHash !== lastMcpServerConfigHash
}

/**
 * Save current configuration information to cache
 */
const updateConfigCache = (servers: McpServerConfig[] = []): void => {
  lastMcpServerConfigHash = generateConfigHash(servers)
  lastMcpServerLength = servers.length
  lastMcpServerNames = servers.map((s) => s.name).sort()
  console.log(`Updated MCP config cache with ${servers.length} server(s)`)
}

// Receive MCP server configuration from agent
export const initMcpFromAgentConfig = async (mcpServers: McpServerConfig[] = []) => {
  // Explicit debug information display
  console.log(`initMcpFromAgentConfig called with ${mcpServers.length} server(s)`)

  // Check if there are any changes
  if (!hasConfigChanged(mcpServers)) {
    console.log('MCP configuration unchanged, skipping initialization')
    return
  }

  // If initialization is in progress, wait
  if (initializationInProgress) {
    console.log('MCP initialization already in progress, waiting...')
    try {
      await initializationInProgress
      console.log('Finished waiting for previous MCP initialization')

      // If another process completed initialization with the same configuration during wait, skip
      if (!hasConfigChanged(mcpServers)) {
        console.log('MCP already initialized with same configuration during wait')
        return
      }
    } catch (error) {
      console.log('Previous MCP initialization failed:', error)
      // Continue even if there's an error to start new initialization
    }
  }

  console.log(`Starting MCP initialization with ${mcpServers.length} server(s)...`)

  // Start initialization process
  try {
    initializationInProgress = (async () => {
      // Clean up existing clients
      console.log(`Cleaning up ${clients.length} existing MCP clients...`)
      await Promise.all(
        clients.map(async ({ client }) => {
          try {
            await client.cleanup()
          } catch (e) {
            console.log(`Failed to clean up MCP client: ${e}`)
          }
        })
      )
      clients = []

      // Create new clients
      if (mcpServers.length === 0) {
        console.log('No MCP servers configured for this agent')
        updateConfigCache(mcpServers)
        return
      }

      // Convert McpServerConfig[] format to configSchema format
      const configData = {
        mcpServers: mcpServers.reduce(
          (acc, server) => {
            acc[server.name] = {
              command: server.command,
              args: server.args,
              env: server.env || {}
            }
            return acc
          },
          {} as Record<string, { command: string; args: string[]; env?: Record<string, string> }>
        )
      }

      // Validation using configSchema
      const { success, error } = configSchema.safeParse(configData)
      if (!success) {
        console.error('Invalid MCP server configuration:', error)
        throw new Error('Invalid MCP server configuration')
      }

      console.log(`Creating ${mcpServers.length} new MCP clients...`)
      clients = (
        await Promise.all(
          mcpServers.map(async (serverConfig) => {
            try {
              console.log(`Starting MCP server: ${serverConfig.name}`)
              const client = await MCPClient.fromCommand(
                serverConfig.command,
                serverConfig.args,
                serverConfig.env
              )
              return { name: serverConfig.name, client }
            } catch (e) {
              console.log(
                `MCP server ${serverConfig.name} failed to start: ${e}. Ignoring the server...`
              )
              return undefined
            }
          })
        )
      ).filter((c): c is { name: string; client: MCPClient } => c != null)

      // Update configuration hash after initialization is complete
      updateConfigCache(mcpServers)
      console.log(`MCP initialization complete with ${clients.length} server(s)`)
    })()

    await initializationInProgress
  } catch (error) {
    console.error('Error during MCP initialization:', error)
    // Clear cache in case of error to allow retry next time
    lastMcpServerConfigHash = null
    lastMcpServerLength = 0
    lastMcpServerNames = []
    updateConfigCache([])
    throw error
  } finally {
    initializationInProgress = null
  }
}

export const getMcpToolSpecs = async (mcpServers?: McpServerConfig[]): Promise<Tool[]> => {
  // Return an empty array if no MCP server configuration
  if (!mcpServers || mcpServers.length === 0) {
    return []
  }

  // Use agent-specific MCP server configuration
  await initMcpFromAgentConfig(mcpServers)

  // Add a prefix to tools to avoid name collisions
  return clients.flatMap(({ client }) => {
    // Deep copy to avoid modifying the original object
    return client.tools.map((tool) => {
      const clonedTool = JSON.parse(JSON.stringify(tool))
      if (clonedTool.toolSpec?.name) {
        clonedTool.toolSpec.name = `mcp_${clonedTool.toolSpec.name}`
      }
      return clonedTool
    })
  })
}

export const tryExecuteMcpTool = async (
  toolName: string,
  input: any,
  mcpServers?: McpServerConfig[]
) => {
  // Return not found if no MCP server configuration
  if (!mcpServers || mcpServers.length === 0) {
    return {
      found: false,
      success: false,
      name: `mcp_${toolName}`,
      error: `No MCP servers configured`,
      message: `This agent does not have any MCP servers configured. Please add MCP server configuration in agent settings.`,
      result: null
    }
  }

  // Use agent-specific MCP server configuration
  await initMcpFromAgentConfig(mcpServers)

  // Use raw tool name (without mcp_ prefix)
  const client = clients.find(({ client }) =>
    client.tools.find((tool) => tool.toolSpec?.name == toolName)
  )
  if (client == null) {
    return {
      found: false,
      success: false,
      name: `mcp_${toolName}`,
      error: `MCP tool ${toolName} not found`,
      message: `No MCP server provides a tool named "${toolName}"`,
      result: null
    }
  }

  try {
    // Use tool name without mcp_ prefix from input type
    const params = { ...input }
    const res = await client.client.callTool(toolName, params)

    return {
      found: true,
      success: true,
      name: `mcp_${toolName}`,
      message: 'MCP tool execution successful',
      result: res
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    return {
      found: true,
      success: false,
      name: `mcp_${toolName}`,
      error: errorMessage,
      message: `Error executing MCP tool "${toolName}": ${errorMessage}`,
      result: null
    }
  }
}

/**
 * Function to test connection to MCP server
 * @param mcpServer Server configuration to test
 * @return Test result object
 */
export const testMcpServerConnection = async (
  mcpServer: McpServerConfig
): Promise<{
  success: boolean
  message: string
  details?: {
    toolCount?: number
    toolNames?: string[]
    error?: string
    errorDetails?: string
    startupTime?: number
  }
}> => {
  console.log(`Testing connection to MCP server: ${mcpServer.name}`)
  const startTime = Date.now()

  try {
    // Create a temporary client for a single server
    const client = await MCPClient.fromCommand(mcpServer.command, mcpServer.args, mcpServer.env)

    // Get tool information
    const tools = client.tools || []
    // Type error fix: exclude undefined and convert to string[]
    const toolNames = tools
      .map((t) => t.toolSpec?.name)
      .filter((name): name is string => Boolean(name))

    // Clean up client
    await client.cleanup()

    const endTime = Date.now()
    return {
      success: true,
      message: `Successfully connected to MCP server "${mcpServer.name}"`,
      details: {
        toolCount: tools.length,
        toolNames,
        startupTime: endTime - startTime
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    // Remove unused variable
    // const errorStack = error instanceof Error ? error.stack : undefined

    // Detailed error analysis
    const errorAnalysis = analyzeServerError(errorMessage)

    return {
      success: false,
      message: `Failed to connect to MCP server "${mcpServer.name}"`,
      details: {
        error: errorMessage,
        errorDetails: errorAnalysis
      }
    }
  }
}

/**
 * Function to test connection to multiple MCP servers
 * @param mcpServers Array of server configurations to test
 * @return Test result object keyed by server name
 */
export const testAllMcpServerConnections = async (
  mcpServers: McpServerConfig[]
): Promise<
  Record<
    string,
    {
      success: boolean
      message: string
      details?: {
        toolCount?: number
        toolNames?: string[]
        error?: string
        errorDetails?: string
        startupTime?: number
      }
    }
  >
> => {
  // Return empty object if no MCP server configuration
  if (!mcpServers || mcpServers.length === 0) {
    return {}
  }

  const results: Record<string, any> = {}

  // Execute tests sequentially (serially)
  for (const server of mcpServers) {
    results[server.name] = await testMcpServerConnection(server)
  }

  return results
}

/**
 * Analyze error message and suggest cause and solution
 */
function analyzeServerError(errorMessage: string): string {
  const lowerError = errorMessage.toLowerCase()

  if (lowerError.includes('enoent') || lowerError.includes('command not found')) {
    return 'Command not found. Please make sure the command is installed and the path is correct.'
  }

  if (lowerError.includes('timeout')) {
    return 'The response from the server timed out. Please check if the server is running properly.'
  }

  if (lowerError.includes('permission denied') || lowerError.includes('eacces')) {
    return 'A permission error occurred. Please make sure you have the execution permissions.'
  }

  if (lowerError.includes('port') && lowerError.includes('use')) {
    return 'The port is already in use. Please make sure that no other process is using the same port.'
  }

  return 'Please make sure your command and arguments are correct.'
}

export const getMcpTools = async (mcpServers: McpServerConfig[] = []): Promise<ToolState[]> => {
  // Return empty array if no MCP server configuration
  if (!mcpServers || mcpServers.length === 0) {
    return []
  }

  // Use agent-specific MCP server configuration
  await initMcpFromAgentConfig(mcpServers)

  // Add prefix to tools (to avoid name collisions)
  return clients.flatMap(({ client }) =>
    client.client.getTools().map((tool) => ({
      ...tool,
      name: `${client.name}:${tool.name}`
    }))
  )
}
