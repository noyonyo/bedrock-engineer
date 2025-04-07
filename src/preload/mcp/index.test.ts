import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals'
import { getMcpToolSpecs, tryExecuteMcpTool } from './index'
import * as mcpClient from './mcp-client'
import { McpServerConfig } from '../../types/agent-chat'

// Mock MCPClient
jest.mock('./mcp-client', () => {
  return {
    MCPClient: {
      fromCommand: jest.fn().mockImplementation(() => {
        return {
          tools: [
            {
              toolSpec: {
                name: 'mockTool',
                description: 'A mocked tool for testing',
                inputSchema: { json: { type: 'object' } }
              }
            }
          ],
          callTool: jest.fn().mockImplementation((toolName) => {
            if (toolName === 'mockTool') {
              return [{ type: 'text', text: 'Mock tool response' }]
            }
            throw new Error(`Tool ${toolName} not found`)
          }),
          cleanup: jest.fn()
        }
      })
    }
  }
})

describe('MCP Module Tests', () => {
  // Mock MCP server configuration for testing
  const mockMcpServers: McpServerConfig[] = [
    {
      name: 'mock-server',
      description: 'Mock MCP server for testing',
      command: 'mock-command',
      args: ['arg1', 'arg2'],
      env: { TEST_ENV: 'test_value' }
    }
  ]

  beforeEach(() => {
    jest.clearAllMocks()
    // Reset the module's state between tests
    jest.resetModules()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('should get tool specs from MCP clients', async () => {
    // Pass mcpServers parameter
    const tools = await getMcpToolSpecs(mockMcpServers)

    // Verify MCPClient.fromCommand was called
    expect(mcpClient.MCPClient.fromCommand).toHaveBeenCalled()

    // Verify tool list is returned
    expect(Array.isArray(tools)).toBe(true)
    expect(tools.length).toBeGreaterThan(0)

    const firstTool = tools[0]
    expect(firstTool).toHaveProperty('toolSpec')
    expect(firstTool.toolSpec?.name).toBe('mcp_mockTool') // Verify 'mcp_' prefix is added
  })

  test('should execute a valid MCP tool', async () => {
    // First get tool specification (client initialization)
    await getMcpToolSpecs(mockMcpServers)

    // Execute mock tool (pass mcpServers parameter)
    const result = await tryExecuteMcpTool('mockTool', { testParam: 'value' }, mockMcpServers)

    // Verify result
    expect(result.found).toBe(true)
    expect(result.success).toBe(true)
    expect(result.result).toBeDefined()
    expect(result.result).toEqual([{ type: 'text', text: 'Mock tool response' }])
  })

  test('should return not found for invalid tool', async () => {
    // Client initialization
    await getMcpToolSpecs(mockMcpServers)

    // Test with non-existent tool name (pass mcpServers parameter)
    const result = await tryExecuteMcpTool('non_existent_tool', {}, mockMcpServers)

    // Should not find
    expect(result.found).toBe(false)
    expect(result.success).toBe(false)
  })
})
