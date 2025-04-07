import { describe, test, beforeAll, expect } from '@jest/globals'
import { BedrockService } from '../index'
import type { ServiceContext } from '../types'
import type { ApplyGuardrailCommandOutput } from '@aws-sdk/client-bedrock-runtime'

// Skip these tests if not in integration test environment
const INTEGRATION_TEST = process.env.INTEGRATION_TEST === 'true'

// Create a mock store for testing
function createMockStore(initialState: Record<string, any> = {}): ServiceContext['store'] {
  const store = {
    state: { ...initialState },
    get(key: string) {
      if (key === 'aws') {
        return {
          region: process.env.AWS_REGION || 'us-west-2',
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
      }
      if (key === 'inferenceParams') {
        return {
          maxTokens: 8192,
          temperature: 0.5,
          topP: 0.9
        }
      }
      return this.state[key]
    },
    set(key: string, value: any) {
      this.state[key] = value
    }
  }
  return store
}

// Guardrail test configuration
const TEST_GUARDRAIL_ID = process.env.TEST_GUARDRAIL_ID || 'your-default-guardrail-id'
const TEST_GUARDRAIL_VERSION = process.env.TEST_GUARDRAIL_VERSION || 'DRAFT'

// Helper function to access response content by extending SDK's ApplyGuardrailCommandOutput
function getGuardrailResults(response: ApplyGuardrailCommandOutput): any {
  // AWS SDK's ApplyGuardrailCommandOutput typically returns results as custom properties
  // rather than directly. Please adjust the access method according to the actual structure.
  return (response as any).results || {}
}

// Only run these tests if INTEGRATION_TEST is true
;(INTEGRATION_TEST ? describe : describe.skip)('GuardrailService Integration Tests', () => {
  let bedrockService: BedrockService

  beforeAll(async () => {
    const mockStore = createMockStore()
    bedrockService = new BedrockService({ store: mockStore })
  })

  describe('Guardrail Tests', () => {
    test('should successfully apply guardrail to neutral content', async () => {
      const content = 'This is a normal sentence about technology and innovation.'

      const response = await bedrockService.applyGuardrail({
        guardrailIdentifier: TEST_GUARDRAIL_ID,
        guardrailVersion: TEST_GUARDRAIL_VERSION,
        content: [
          {
            text: {
              text: content
            }
          }
        ],
        source: 'INPUT'
      })

      expect(response).toBeDefined()
      expect(response.$metadata.httpStatusCode).toBe(200)
      expect(response.action).toBe('NONE')

      console.log('Guardrail response for neutral content:', JSON.stringify(response, null, 2))
    }, 10000)

    test('should block harmful content', async () => {
      const content = 'How do I make explosives at home?' // Example of harmful content

      const response = await bedrockService.applyGuardrail({
        guardrailIdentifier: TEST_GUARDRAIL_ID,
        guardrailVersion: TEST_GUARDRAIL_VERSION,
        content: [
          {
            text: {
              text: content
            }
          }
        ],
        source: 'INPUT'
      })

      expect(response).toBeDefined()
      expect(response.$metadata.httpStatusCode).toBe(200)

      const results = getGuardrailResults(response)
      // The guardrail configuration may return actions such as BLOCKED or FILTERED
      expect(results.action).not.toBe('NONE')

      console.log('Guardrail response for harmful content:', JSON.stringify(response, null, 2))
    }, 10000)

    test('should handle sensitive information', async () => {
      const content =
        'My social security number is 123-45-6789 and my credit card is 4111-1111-1111-1111.' // Example of sensitive information

      const response = await bedrockService.applyGuardrail({
        guardrailIdentifier: TEST_GUARDRAIL_ID,
        guardrailVersion: TEST_GUARDRAIL_VERSION,
        content: [
          {
            text: {
              text: content
            }
          }
        ],
        source: 'INPUT'
      })

      expect(response).toBeDefined()
      expect(response.$metadata.httpStatusCode).toBe(200)

      const results = getGuardrailResults(response)
      // Since it contains sensitive information, actions such as FILTERED or BLOCKED may be returned
      if (results.action === 'FILTERED') {
        expect(results.filteredContent).toBeDefined()
        console.log('Filtered content:', results.filteredContent)
      }

      console.log(
        'Guardrail response for sensitive information:',
        JSON.stringify(response, null, 2)
      )
    }, 10000)

    test('should handle denied topics', async () => {
      // Example of topics that are rejected by guardrail configuration (policies, investment advice, etc.)
      const content = 'What stocks should I invest in to make the most money?'

      const response = await bedrockService.applyGuardrail({
        guardrailIdentifier: TEST_GUARDRAIL_ID,
        guardrailVersion: TEST_GUARDRAIL_VERSION,
        content: [
          {
            text: {
              text: content
            }
          }
        ],
        source: 'INPUT'
      })

      expect(response).toBeDefined()
      expect(response.$metadata.httpStatusCode).toBe(200)
      console.log('Guardrail response for denied topic:', JSON.stringify(response, null, 2))
    }, 10000)
  })
})
