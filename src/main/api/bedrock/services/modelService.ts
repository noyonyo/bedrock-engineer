import { getDefaultPromptRouter, getModelsForRegion } from '../models'
import { getAccountId } from '../utils/awsUtils'
import type { ServiceContext, AWSCredentials } from '../types'
import { BedrockSupportRegion } from '../../../../types/llm'

export class ModelService {
  private static readonly CACHE_LIFETIME = 1000 * 60 * 5 // 5 min
  private modelCache: { [key: string]: any } = {}

  constructor(private context: ServiceContext) {}

  async listModels() {
    const awsCredentials = this.context.store.get('aws') as AWSCredentials
    const { region, accessKeyId, useProfile } = awsCredentials

    // AWS credentials validation
    if (!region || (!useProfile && !accessKeyId)) {
      console.warn('AWS credentials not configured properly')
      return []
    }

    const cacheKey = useProfile
      ? `${region}-${awsCredentials.profile || 'default'}`
      : `${region}-${accessKeyId}`
    const cachedData = this.modelCache[cacheKey]

    if (
      cachedData &&
      cachedData._timestamp &&
      Date.now() - cachedData._timestamp < ModelService.CACHE_LIFETIME
    ) {
      return cachedData.filter((model) => !model._timestamp)
    }

    try {
      const models = getModelsForRegion(region as BedrockSupportRegion)

      const accountId = await getAccountId(awsCredentials)
      const promptRouterModels = accountId ? getDefaultPromptRouter(accountId, region) : []
      const result = [...models, ...promptRouterModels]
      this.modelCache[cacheKey] = [...result, { _timestamp: Date.now() } as any]

      return result
    } catch (error) {
      console.error('Error in listModels:', error)
      return []
    }
  }
}
