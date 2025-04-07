import { jest, describe, test, expect, afterAll } from '@jest/globals'
import { getMcpToolSpecs, tryExecuteMcpTool } from './index'

// Set longer timeout for tests
jest.setTimeout(60000)

describe('MCP Integration Tests', () => {
  afterAll(() => {
    jest.restoreAllMocks()
  })

  test('should initialize MCP clients and get tool specs', async () => {
    const tools = await getMcpToolSpecs()

    // Verify that tools can be retrieved
    expect(Array.isArray(tools)).toBe(true)

    // Verify basic structure of each tool (list may be empty)
    if (tools.length > 0) {
      const firstTool = tools[0]
      expect(firstTool).toHaveProperty('toolSpec')

      // Display available tool names
      console.log('Available tools:', tools.map((tool) => tool.toolSpec?.name).filter(Boolean))
    } else {
      console.log('No MCP tools were found.')
    }
  })

  // Basic test for non-existent tool - this should not normally fail
  test('should return not found for invalid tool', async () => {
    const result = await tryExecuteMcpTool('non_existent_tool', {})
    expect(result.found).toBe(false)
  })
})
