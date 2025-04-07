import {
  ApplyGuardrailCommand,
  ApplyGuardrailCommandInput,
  ApplyGuardrailCommandOutput,
  ApplyGuardrailRequest
} from '@aws-sdk/client-bedrock-runtime'
import { createRuntimeClient } from '../client'
import { createCategoryLogger } from '../../../../common/logger'
import type { ServiceContext } from '../types'

// Create category logger for guardrail service
const guardrailLogger = createCategoryLogger('bedrock:guardrail')

/**
 * Service class that integrates with Bedrock Guardrail API
 * Responsible for evaluating text content against guardrails
 */
export class GuardrailService {
  private static readonly MAX_RETRIES = 3
  private static readonly RETRY_DELAY = 1000

  constructor(private context: ServiceContext) {}

  /**
   * Apply guardrail evaluation
   * @param request Guardrail evaluation request
   * @returns Guardrail evaluation result
   */
  async applyGuardrail(
    request: ApplyGuardrailRequest,
    retries = 0
  ): Promise<ApplyGuardrailCommandOutput> {
    try {
      // Prepare request parameters
      // Prepare according to AWS SDK ApplyGuardrailCommandInput actual type
      const commandParams: ApplyGuardrailCommandInput = {
        guardrailIdentifier: request.guardrailIdentifier,
        guardrailVersion: request.guardrailVersion,
        content: request.content,
        source: request.source
      }

      const runtimeClient = createRuntimeClient(this.context.store.get('aws'))
      const awsConfig = this.context.store.get('aws')

      // Log output before API request
      guardrailLogger.debug('Sending apply guardrail request', {
        guardrailId: request.guardrailIdentifier,
        guardrailVersion: request.guardrailVersion,
        region: awsConfig.region
      })

      // Send API request
      const command = new ApplyGuardrailCommand(commandParams)
      return await runtimeClient.send(command)
    } catch (error: any) {
      return this.handleError(error, request, retries)
    }
  }

  /**
   * Handle errors
   */
  private async handleError(
    error: any,
    request: ApplyGuardrailRequest,
    retries: number
  ): Promise<ApplyGuardrailCommandOutput> {
    // In case of throttling or service unavailable
    if (error.name === 'ThrottlingException' || error.name === 'ServiceUnavailableException') {
      guardrailLogger.warn(`${error.name} occurred - retrying`, {
        retry: retries,
        errorName: error.name,
        message: error.message,
        guardrailId: request.guardrailIdentifier
      })

      // Throw error if max retry count exceeded
      if (retries >= GuardrailService.MAX_RETRIES) {
        guardrailLogger.error('Maximum retries reached for Bedrock API request', {
          maxRetries: GuardrailService.MAX_RETRIES,
          errorName: error.name,
          guardrailId: request.guardrailIdentifier
        })
        throw error
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, GuardrailService.RETRY_DELAY))
      return this.applyGuardrail(request, retries + 1)
    }

    // In case of validation error
    if (error.name === 'ValidationException') {
      guardrailLogger.error('ValidationException in applyGuardrail', {
        errorMessage: error.message,
        errorDetails: error.$metadata,
        guardrailId: request.guardrailIdentifier
      })
    } else {
      // In case of other errors
      guardrailLogger.error('Error in applyGuardrail', {
        errorName: error.name,
        errorMessage: error.message,
        guardrailId: request.guardrailIdentifier,
        stack: error.stack
      })
    }

    throw error
  }
}
