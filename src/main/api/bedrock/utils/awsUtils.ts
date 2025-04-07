import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import type { AWSCredentials } from '../types'
import { baseModels, usModels, euModels, apacModels } from '../models'
import type { LLM } from '../../../../types/llm'
import { fromIni } from '@aws-sdk/credential-providers'

/**
 * Get model information corresponding to the specified model ID
 */
function findModelById(modelId: string): LLM | undefined {
  // Combine all model lists and search
  const allModels = [...baseModels, ...usModels, ...euModels, ...apacModels]
  return allModels.find((model) => model.modelId === modelId)
}

/**
 * Select an alternate region when ThrottlingException occurs
 * Returns a random region different from the current region
 *
 * @param currentRegion Current region
 * @param modelId Model ID
 * @returns Selected region (different from current region)
 */
export function getAlternateRegionOnThrottling(
  currentRegion: string,
  modelId: string,
  configuredRegions: string[] = []
): string {
  // Get model information
  const model = findModelById(modelId)
  if (!model || !model.regions) {
    return currentRegion
  }

  // Get the intersection of configured available regions and model's available regions
  let availableRegions =
    configuredRegions.length > 0
      ? model.regions.filter((region) => configuredRegions.includes(region))
      : model.regions

  // Exclude current region
  availableRegions = availableRegions.filter((region) => region !== currentRegion)

  // Return current region if no available regions
  if (availableRegions.length === 0) {
    return currentRegion
  }

  // Randomly select another region
  const randomIndex = Math.floor(Math.random() * availableRegions.length)
  return availableRegions[randomIndex]
}

export async function getAccountId(awsCredentials: AWSCredentials) {
  try {
    const { region, useProfile, profile } = awsCredentials

    const sts = new STSClient({
      credentials:
        useProfile && profile
          ? fromIni({ profile })
          : {
              accessKeyId: awsCredentials.accessKeyId,
              secretAccessKey: awsCredentials.secretAccessKey,
              sessionToken: awsCredentials?.sessionToken
            },
      region
    })

    const command = new GetCallerIdentityCommand({})
    const res = await sts.send(command)
    return res.Account
  } catch (error) {
    console.error('Error getting AWS account ID:', error)
    return null
  }
}
