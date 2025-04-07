import * as fs from 'fs/promises'
import * as path from 'path'
import GitignoreLikeMatcher from '../lib/gitignore-like-matcher'
import { ipcRenderer } from 'electron'
import { ContentChunker, ContentChunk } from '../lib/contentChunker'
import { ToolResult } from '../../types/tools'
import { CommandService } from '../../main/api/command/commandService'
import {
  CommandPatternConfig,
  CommandInput,
  CommandStdinInput,
  ProcessInfo
} from '../../main/api/command/types'

// Modified CommandConfig type
interface CommandConfig {
  allowedCommands?: CommandPatternConfig[]
  shell: string
}
import {
  BedrockService,
  ImageGeneratorModel,
  AspectRatio,
  OutputFormat
} from '../../main/api/bedrock'
import { FileUseCase, InvokeAgentCommandOutput } from '@aws-sdk/client-bedrock-agent-runtime'
import { InvokeAgentInput } from '../../main/api/bedrock/services/agentService'
import { createPreloadCategoryLogger } from '../logger'

const MAX_CHUNK_SIZE = 50000 // About 50,000 characters (considering Claude 3 Haiku limit) TODO: Adapt for each LLM

interface GenerateImageResult extends ToolResult {
  name: 'generateImage'
  result: {
    imagePath: string
    modelUsed: string
    seed?: number
    prompt: string
    negativePrompt?: string
    aspect_ratio: string
  }
}

interface RetrieveResult extends ToolResult {
  name: 'retrieve'
}

interface ThinkResult extends ToolResult {
  name: 'think'
  result: {
    reasoning: string
  }
}

type Completion = {
  message?: string
  files?: string[]
  // traces: TracePart[]
}

type InvokeAgentResultOmitFile = {
  $metadata: InvokeAgentCommandOutput['$metadata']
  contentType: InvokeAgentCommandOutput['contentType']
  sessionId: InvokeAgentCommandOutput['sessionId']
  completion?: Completion
}

interface InvokeBedrockAgentResult extends ToolResult<InvokeAgentResultOmitFile> {
  name: 'invokeBedrockAgent'
}

interface TavilySearchSearchResponse {
  title: string
  url: string
  content: string
  score: number
  raw_content: string
}

interface TavilySearchResult extends ToolResult {
  name: 'tavilySearch'
  success: boolean
  message: string
  result: {
    query: string
    follow_up_questions: null | string[]
    answer: string
    images: string[]
    results: TavilySearchSearchResponse[]
    response_time: number
  }
}

interface ExecuteCommandResult extends ToolResult {
  name: 'executeCommand'
  stdout: string
  stderr: string
  exitCode: number
  processInfo?: ProcessInfo
  requiresInput?: boolean
  prompt?: string
}

// Store command service instance and its configuration
interface CommandServiceState {
  service: CommandService
  config: CommandConfig
}

let commandServiceState: CommandServiceState | null = null

// Create logger for tool service
const logger = createPreloadCategoryLogger('tools')

export class ToolService {
  private getCommandService(config: CommandConfig): CommandService {
    // Create new instance if configuration changes
    if (
      !commandServiceState ||
      JSON.stringify(commandServiceState.config) !== JSON.stringify(config)
    ) {
      commandServiceState = {
        service: new CommandService(config),
        config
      }
    }
    return commandServiceState.service
  }

  async createFolder(folderPath: string): Promise<string> {
    logger.debug(`Creating folder: ${folderPath}`)
    try {
      await fs.mkdir(folderPath, { recursive: true })
      logger.info(`Folder created: ${folderPath}`)
      return `Folder created: ${folderPath}`
    } catch (e: any) {
      logger.error(`Error creating folder: ${folderPath}`, { error: e.message })
      throw `Error creating folder: ${e.message}`
    }
  }

  async writeToFile(filePath: string, content: string): Promise<string> {
    logger.debug(`Writing to file: ${filePath}`)
    try {
      await fs.writeFile(filePath, content)
      logger.info(`Content written to file: ${filePath}`, {
        contentLength: content.length
      })
      return `Content written to file: ${filePath}\n\n${content}`
    } catch (e: any) {
      logger.error(`Error writing to file: ${filePath}`, { error: e.message })
      throw `Error writing to file: ${e.message}`
    }
  }

  async applyDiffEdit(
    path: string,
    originalText: string,
    updatedText: string
  ): Promise<ToolResult> {
    logger.debug(`Applying diff edit to file: ${path}`)
    try {
      // Read file contents
      const fileContent = await fs.readFile(path, 'utf-8')

      // Check if original text exists
      if (!fileContent.includes(originalText)) {
        logger.warn(`Original text not found in file: ${path}`)
        return {
          name: 'applyDiffEdit',
          success: false,
          error: 'Original text not found in file',
          result: null
        }
      }

      // Replace text
      const newContent = fileContent.replace(originalText, updatedText)

      // Write to file
      await fs.writeFile(path, newContent, 'utf-8')

      logger.info(`Successfully applied diff edit to file: ${path}`, {
        originalTextLength: originalText.length,
        updatedTextLength: updatedText.length
      })

      return {
        name: 'applyDiffEdit',
        success: true,
        message: 'Successfully applied diff edit',
        result: {
          path,
          originalText,
          updatedText
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      logger.error(`Error applying diff edit to file: ${path}`, { error: errorMessage })

      throw new Error(
        `Error applying diff edit: ${JSON.stringify({
          name: 'applyDiffEdit',
          success: false,
          error: errorMessage,
          result: null
        })}`
      )
    }
  }

  private async buildFileTree(
    dirPath: string,
    prefix: string = '',
    ignoreFiles?: string[],
    depth: number = 0,
    maxDepth: number = -1
  ): Promise<{ content: string; hasMore: boolean }> {
    logger.debug(`Building file tree for directory: ${dirPath}`, {
      depth,
      maxDepth,
      ignorePatterns: ignoreFiles?.length || 0
    })

    try {
      if (maxDepth !== -1 && depth > maxDepth) {
        logger.verbose(`Reached max depth (${maxDepth}) for directory: ${dirPath}`)
        return { content: `${prefix}...\n`, hasMore: true }
      }

      const files = await fs.readdir(dirPath, { withFileTypes: true })
      const matcher = new GitignoreLikeMatcher(ignoreFiles ?? [])
      let result = ''
      let hasMore = false

      logger.verbose(`Processing ${files.length} files/directories in ${dirPath}`)

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const isLast = i === files.length - 1
        const currentPrefix = prefix + (isLast ? '└── ' : '├── ')
        const nextPrefix = prefix + (isLast ? '    ' : '│   ')
        const filePath = path.join(dirPath, file.name)
        const relativeFilePath = path.relative(process.cwd(), filePath)

        if (ignoreFiles && ignoreFiles.length && matcher.isIgnored(relativeFilePath)) {
          logger.verbose(`Ignoring file/directory: ${relativeFilePath}`)
          continue
        }

        if (file.isDirectory()) {
          result += `${currentPrefix}📁 ${file.name}\n`
          const subTree = await this.buildFileTree(
            filePath,
            nextPrefix,
            ignoreFiles,
            depth + 1,
            maxDepth
          )
          result += subTree.content
          hasMore = hasMore || subTree.hasMore
        } else {
          result += `${currentPrefix}📄 ${file.name}\n`
        }
      }

      logger.debug(`Completed file tree for directory: ${dirPath}`, {
        depth,
        hasMore,
        processedItems: files.length
      })

      return { content: result, hasMore }
    } catch (e: any) {
      logger.error(`Error building file tree for: ${dirPath}`, {
        error: e instanceof Error ? e.message : String(e),
        depth,
        maxDepth
      })
      throw `Error building file tree: ${e}`
    }
  }

  private createDirectoryChunks(
    treeContent: string,
    chunkSize: number = MAX_CHUNK_SIZE
  ): ContentChunk[] {
    const lines = treeContent.split('\n')
    const chunks: ContentChunk[] = []
    let currentChunk = ''
    let currentSize = 0

    for (const line of lines) {
      const lineSize = line.length + 1 // +1 for newline
      if (currentSize + lineSize > chunkSize && currentChunk) {
        chunks.push({
          content: currentChunk,
          index: chunks.length + 1,
          total: 0, // will be updated later
          metadata: {
            timestamp: Date.now()
          }
        })
        currentChunk = ''
        currentSize = 0
      }
      currentChunk += line + '\n'
      currentSize += lineSize
    }

    if (currentChunk) {
      chunks.push({
        content: currentChunk,
        index: chunks.length + 1,
        total: 0,
        metadata: {
          timestamp: Date.now()
        }
      })
    }

    // Update total count
    chunks.forEach((chunk) => (chunk.total = chunks.length))
    return chunks
  }

  async listFiles(
    dirPath: string,
    options?: {
      ignoreFiles?: string[]
      chunkIndex?: number
      maxDepth?: number
      chunkSize?: number
    }
  ): Promise<string> {
    logger.debug(`Listing files in directory: ${dirPath}`, {
      options: JSON.stringify({
        chunkIndex: options?.chunkIndex,
        maxDepth: options?.maxDepth,
        ignoreFilesCount: options?.ignoreFiles?.length || 0
      })
    })

    try {
      const { ignoreFiles, chunkIndex, maxDepth = -1, chunkSize = MAX_CHUNK_SIZE } = options || {}
      logger.debug(`Building file tree with maxDepth: ${maxDepth}, chunkSize: ${chunkSize}`)

      const fileTreeResult = await this.buildFileTree(dirPath, '', ignoreFiles, 0, maxDepth)
      const chunks = this.createDirectoryChunks(fileTreeResult.content, chunkSize)

      logger.debug(`Directory content split into ${chunks.length} chunks`)

      // Store chunks in global store for subsequent requests
      const chunkStore: Map<string, ContentChunk[]> = global.directoryChunkStore || new Map()
      const cacheKey = `${dirPath}-${maxDepth}`
      chunkStore.set(cacheKey, chunks)
      global.directoryChunkStore = chunkStore

      if (typeof chunkIndex === 'number') {
        if (chunkIndex < 1 || chunkIndex > chunks.length) {
          const errorMessage = `Invalid chunk index. Available chunks: 1 to ${chunks.length}`
          logger.warn(errorMessage, { requestedChunk: chunkIndex })
          throw new Error(errorMessage)
        }
        const chunk = chunks[chunkIndex - 1]
        logger.info(`Returning directory structure chunk ${chunk.index} of ${chunk.total}`, {
          dirPath,
          chunkIndex: chunk.index,
          totalChunks: chunk.total
        })
        return `Directory Structure (Chunk ${chunk.index}/${chunk.total}):\n\n${chunk.content}`
      }

      if (chunks.length === 1) {
        logger.info(`Returning complete directory structure`, { dirPath, singleChunk: true })
        return `Directory Structure:\n\n${chunks[0].content}`
      }

      // Return summary if multiple chunks
      logger.info(`Returning directory structure summary with ${chunks.length} chunks`, {
        dirPath,
        chunkCount: chunks.length,
        hasMore: fileTreeResult.hasMore
      })

      return [
        'Directory structure has been split into multiple chunks:',
        `Total Chunks: ${chunks.length}`,
        `Max Depth: ${maxDepth === -1 ? 'unlimited' : maxDepth}`,
        fileTreeResult.hasMore ? '\nNote: Some directories are truncated due to depth limit.' : '',
        '\nTo retrieve specific chunks, use the listFiles tool with chunkIndex option:',
        'Example usage:',
        '```',
        `listFiles("${dirPath}", { chunkIndex: 1, maxDepth: ${maxDepth} })`,
        '```\n'
      ].join('\n')
    } catch (e: any) {
      logger.error(`Error listing directory structure: ${dirPath}`, {
        error: e instanceof Error ? e.message : String(e),
        options: JSON.stringify(options)
      })
      throw `Error listing directory structure: ${e}`
    }
  }

  async moveFile(source: string, destination: string): Promise<string> {
    logger.debug(`Moving file from ${source} to ${destination}`)
    try {
      await fs.rename(source, destination)
      logger.info(`File moved successfully`, {
        source,
        destination
      })
      return `File moved: ${source} to ${destination}`
    } catch (e: any) {
      logger.error(`Error moving file`, {
        source,
        destination,
        error: e.message
      })
      throw `Error moving file: ${e.message}`
    }
  }

  async copyFile(source: string, destination: string): Promise<string> {
    logger.debug(`Copying file from ${source} to ${destination}`)
    try {
      await fs.copyFile(source, destination)
      logger.info(`File copied successfully`, {
        source,
        destination
      })
      return `File copied: ${source} to ${destination}`
    } catch (e: any) {
      logger.error(`Error copying file`, {
        source,
        destination,
        error: e.message
      })
      throw `Error copying file: ${e.message}`
    }
  }

  private createFileChunks(
    content: string,
    filePath: string,
    chunkSize: number = MAX_CHUNK_SIZE
  ): ContentChunk[] {
    const chunks: ContentChunk[] = []
    const lines = content.split('\n')
    let currentChunk = ''
    let currentSize = 0

    // Add file header only to the first chunk
    const fileHeader = `File: ${filePath}\n${'='.repeat(filePath.length + 6)}\n`

    for (const line of lines) {
      const lineWithBreak = line + '\n'
      const lineSize = lineWithBreak.length

      // If this is the first line, account for the header size
      const effectiveSize = currentChunk === '' ? lineSize + fileHeader.length : lineSize

      if (currentSize + effectiveSize > chunkSize && currentChunk) {
        chunks.push({
          content: currentChunk,
          index: chunks.length + 1,
          total: 0,
          metadata: {
            timestamp: Date.now(),
            filePath
          }
        })
        currentChunk = ''
        currentSize = 0
      }

      if (currentChunk === '') {
        // Add header for the first line of each chunk
        currentChunk = chunks.length === 0 ? fileHeader : ''
      }

      currentChunk += lineWithBreak
      currentSize += lineSize
    }

    if (currentChunk) {
      chunks.push({
        content: currentChunk,
        index: chunks.length + 1,
        total: 0,
        metadata: {
          timestamp: Date.now(),
          filePath
        }
      })
    }

    // Update total count
    chunks.forEach((chunk) => (chunk.total = chunks.length))
    return chunks
  }

  async readFiles(
    filePaths: string[],
    options?: {
      chunkIndex?: number
      chunkSize?: number
    }
  ): Promise<string> {
    logger.debug(`Reading files`, {
      fileCount: filePaths.length,
      chunkIndex: options?.chunkIndex,
      chunkSize: options?.chunkSize || MAX_CHUNK_SIZE
    })

    try {
      const { chunkIndex, chunkSize = MAX_CHUNK_SIZE } = options || {}

      // Single file case
      if (filePaths.length === 1) {
        const filePath = filePaths[0]
        logger.debug(`Reading single file: ${filePath}`)

        const content = await fs.readFile(filePath, 'utf-8')
        logger.debug(`File read successfully: ${filePath}`, { contentLength: content.length })

        const chunks = this.createFileChunks(content, filePath, chunkSize)
        logger.debug(`File content split into ${chunks.length} chunks`)

        // Store chunks in global store for subsequent requests
        const chunkStore: Map<string, ContentChunk[]> = global.fileContentChunkStore || new Map()
        chunkStore.set(filePath, chunks)
        global.fileContentChunkStore = chunkStore

        if (typeof chunkIndex === 'number') {
          if (chunkIndex < 1 || chunkIndex > chunks.length) {
            const errorMsg = `Invalid chunk index. Available chunks: 1 to ${chunks.length}`
            logger.warn(errorMsg, { requestedChunk: chunkIndex, availableChunks: chunks.length })
            throw new Error(errorMsg)
          }
          const chunk = chunks[chunkIndex - 1]
          logger.info(`Returning file chunk ${chunk.index}/${chunk.total} for ${filePath}`)
          return `File Content (Chunk ${chunk.index}/${chunk.total}):\n\n${chunk.content}`
        }

        if (chunks.length === 1) {
          logger.info(`Returning complete file content for ${filePath}`)
          return chunks[0].content
        }

        // Return summary if multiple chunks
        const totalLines = content.split('\n').length
        logger.info(`Returning file summary with ${chunks.length} chunks`, {
          filePath,
          totalLines,
          totalChunks: chunks.length
        })

        return [
          'File content has been split into multiple chunks:',
          `File: ${filePath}`,
          `Total Chunks: ${chunks.length}`,
          `Total Lines: ${totalLines}`,
          '\nTo retrieve specific chunks, use the readFiles tool with chunkIndex option:',
          'Example usage:',
          '```',
          `readFiles(["${filePath}"], { chunkIndex: 1 })`,
          '```\n'
        ].join('\n')
      }

      // Multiple files case
      logger.debug(`Reading multiple files: ${filePaths.length} files`)
      const fileContents: string[] = []

      // Process each file sequentially
      for (const filePath of filePaths) {
        try {
          logger.verbose(`Reading file: ${filePath}`)
          const content = await fs.readFile(filePath, 'utf-8')
          const fileHeader = `## File: ${filePath}\n${'='.repeat(filePath.length + 6)}\n`
          fileContents.push(fileHeader + content)
          logger.verbose(`File read successfully: ${filePath}`, { contentLength: content.length })
        } catch (error: any) {
          logger.error(`Error reading file: ${filePath}`, { error: error.message })
          fileContents.push(`## Error reading file: ${filePath}\nError: ${error.message}`)
        }
      }

      // Combine contents of multiple files
      const combinedContent = fileContents.join('\n\n')
      logger.debug(`Combined ${filePaths.length} files`, { totalLength: combinedContent.length })

      // Chunk splitting is necessary
      const chunks = this.createFileChunks(combinedContent, 'Multiple Files', chunkSize)
      logger.debug(`Multiple files content split into ${chunks.length} chunks`)

      // Store chunks for subsequent requests
      const chunkStore: Map<string, ContentChunk[]> = global.fileContentChunkStore || new Map()
      const cacheKey = filePaths.join('||')
      chunkStore.set(cacheKey, chunks)
      global.fileContentChunkStore = chunkStore

      if (typeof chunkIndex === 'number') {
        if (chunkIndex < 1 || chunkIndex > chunks.length) {
          const errorMsg = `Invalid chunk index. Available chunks: 1 to ${chunks.length}`
          logger.warn(errorMsg, { requestedChunk: chunkIndex, availableChunks: chunks.length })
          throw new Error(errorMsg)
        }
        const chunk = chunks[chunkIndex - 1]
        logger.info(`Returning multiple files chunk ${chunk.index}/${chunk.total}`, {
          fileCount: filePaths.length
        })
        return `Files Content (Chunk ${chunk.index}/${chunk.total}):\n\n${chunk.content}`
      }

      if (chunks.length === 1) {
        logger.info(`Returning complete content for ${filePaths.length} files`)
        return chunks[0].content
      }

      // Return summary for multiple chunks
      logger.info(`Returning multiple files summary with ${chunks.length} chunks`, {
        fileCount: filePaths.length,
        totalChunks: chunks.length
      })

      return [
        'Files content has been split into multiple chunks:',
        `Files: ${filePaths.length} files`,
        `Total Chunks: ${chunks.length}`,
        '\nTo retrieve specific chunks, use the readFiles tool with chunkIndex option:',
        'Example usage:',
        '```',
        `readFiles(${JSON.stringify(filePaths)}, { chunkIndex: 1 })`,
        '```\n'
      ].join('\n')
    } catch (e: any) {
      logger.error(`Error reading files`, {
        error: e.message,
        filePaths: JSON.stringify(filePaths)
      })
      throw `Error reading files: ${e.message}`
    }
  }

  async tavilySearch(
    query: string,
    apiKey: string,
    option: { include_raw_content: boolean }
  ): Promise<TavilySearchResult> {
    logger.debug(`Executing Tavily search with query: ${query}`)

    try {
      logger.verbose('Sending request to Tavily API')
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: 'advanced',
          include_answer: true,
          include_images: true,
          include_raw_content: option?.include_raw_content ?? false,
          max_results: 5,
          include_domains: [],
          exclude_domains: []
        })
      })

      logger.verbose('Received response from Tavily API')

      const body = await response.json()

      if (!response.ok) {
        logger.error('Tavily API error', {
          statusCode: response.status,
          query,
          errorResponse: body
        })
        throw new Error(`Tavily API error: ${response.status} ${response.statusText}`)
      }

      logger.info('Tavily search completed successfully', {
        query,
        resultCount: body.results?.length || 0,
        searchId: body.search_id,
        tokensUsed: body.tokens_used
      })

      return {
        success: true,
        name: 'tavilySearch',
        message: `Searched using Tavily. Query: ${query}`,
        result: body
      }
    } catch (e: any) {
      logger.error('Error performing Tavily search', {
        error: e.message,
        query
      })
      throw `Error searching: ${e.message}`
    }
  }

  async fetchWebsite(
    url: string,
    options?: RequestInit & { chunkIndex?: number; cleaning?: boolean }
  ): Promise<string> {
    logger.debug(`Fetching website: ${url}`, {
      options: JSON.stringify({
        method: options?.method || 'GET',
        chunkIndex: options?.chunkIndex,
        cleaning: options?.cleaning
      })
    })

    try {
      const { chunkIndex, ...requestOptions } = options || {}
      const chunkStore: Map<string, ContentChunk[]> = global.chunkStore || new Map()
      let chunks: ContentChunk[] | undefined = chunkStore.get(url)

      if (!chunks) {
        logger.info(`Fetching new content from: ${url}`)

        const response = await ipcRenderer.invoke('fetch-website', url, requestOptions)

        logger.debug(`Website fetch successful: ${url}`, {
          statusCode: response.status,
          contentLength:
            typeof response.data === 'string'
              ? response.data.length
              : JSON.stringify(response.data).length,
          contentType: response.headers['content-type']
        })

        const rawContent =
          typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2)

        logger.verbose(`Splitting content into chunks`, {
          cleaning: !!options?.cleaning
        })

        chunks = ContentChunker.splitContent(rawContent, { url }, { cleaning: options?.cleaning })

        logger.debug(`Content split into ${chunks.length} chunks`)

        chunkStore.set(url, chunks)
        global.chunkStore = chunkStore
      } else {
        logger.debug(`Using cached content for: ${url}`, {
          cachedChunks: chunks.length
        })
      }

      if (typeof chunkIndex === 'number') {
        if (!chunks || chunks.length === 0) {
          const errorMsg = 'No content chunks available'
          logger.warn(errorMsg, { url })
          throw new Error(errorMsg)
        }

        if (chunkIndex < 1 || chunkIndex > chunks.length) {
          const errorMsg = `Invalid chunk index. Available chunks: 1 to ${chunks.length}`
          logger.warn(errorMsg, { requestedChunk: chunkIndex, availableChunks: chunks.length })
          throw new Error(errorMsg)
        }

        const chunk = chunks[chunkIndex - 1]
        const content = options?.cleaning
          ? ContentChunker.extractMainContent(chunk.content)
          : chunk.content

        logger.info(`Returning website content chunk ${chunk.index}/${chunk.total}`, {
          url,
          chunkIndex: chunk.index,
          contentLength: content.length,
          cleaning: !!options?.cleaning
        })

        return `Chunk ${chunk.index}/${chunk.total}:\n\n${content}`
      }

      if (chunks.length === 1) {
        logger.info(`Returning complete website content`, {
          url,
          singleChunk: true,
          contentLength: chunks[0].content.length
        })
        return `Content successfully retrieved:\n\n${chunks[0].content}`
      }

      logger.info(`Returning website content summary with ${chunks.length} chunks`, {
        url,
        chunkCount: chunks.length
      })
      return this.createChunkSummary(chunks)
    } catch (e: any) {
      logger.error(`Error fetching website: ${url}`, {
        error: e.message,
        options: JSON.stringify(options)
      })
      throw `Error fetching website: ${e.message}`
    }
  }

  private createChunkSummary(chunks: ContentChunk[]): string {
    const summary = [
      `Content successfully retrieved and split into ${chunks.length} chunks:`,
      `URL: ${chunks[0].metadata?.url}`,
      `Timestamp: ${new Date(chunks[0].metadata?.timestamp ?? '').toISOString()}`,
      '\nTo retrieve specific chunks, use the fetchWebsite tool with chunkIndex option:',
      `Total Chunks: ${chunks.length}`,
      'Example usage:',
      '```',
      `fetchWebsite("${chunks[0].metadata?.url}", { chunkIndex: 1 })`,
      '```\n'
    ].join('\n')

    return summary
  }

  async generateImage(
    bedrock: BedrockService,
    toolInput: {
      prompt: string
      outputPath: string
      modelId: ImageGeneratorModel
      negativePrompt?: string
      aspect_ratio?: AspectRatio
      seed?: number
      output_format?: OutputFormat
    }
  ): Promise<GenerateImageResult> {
    const {
      prompt,
      outputPath,
      modelId,
      negativePrompt,
      aspect_ratio,
      seed,
      output_format = 'png'
    } = toolInput

    logger.debug('Generating image', {
      modelId,
      prompt: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
      outputPath,
      aspect_ratio,
      seed,
      output_format
    })

    try {
      logger.info('Calling Bedrock to generate image', {
        modelId,
        promptLength: prompt.length
      })

      const result = await bedrock.generateImage({
        modelId,
        prompt,
        negativePrompt,
        aspect_ratio,
        seed,
        output_format
      })

      if (!result.images || result.images.length === 0) {
        logger.warn('Bedrock returned empty images array')
        throw new Error('No image was generated')
      }

      logger.debug('Image generated successfully, saving to disk', {
        outputPath,
        imageDataLength: result.images[0].length
      })

      const imageData = result.images[0]
      const binaryData = Buffer.from(imageData, 'base64')
      await fs.writeFile(outputPath, new Uint8Array(binaryData))

      logger.info('Image saved successfully', {
        outputPath,
        modelId,
        seed: result.seeds?.[0],
        aspect_ratio: aspect_ratio ?? '1:1'
      })

      return {
        success: true,
        name: 'generateImage',
        message: `Image generated successfully and saved to ${outputPath}`,
        result: {
          imagePath: outputPath,
          prompt,
          negativePrompt,
          aspect_ratio: aspect_ratio ?? '1:1',
          modelUsed: modelId,
          seed: result.seeds?.[0]
        }
      }
    } catch (error: any) {
      if (error.name === 'ThrottlingException') {
        const alternativeModels = [
          'stability.sd3-large-v1:0',
          'stability.stable-image-core-v1:1',
          'stability.stable-image-ultra-v1:1'
        ].filter((m) => m !== modelId)

        logger.error('Rate limit exceeded when generating image', {
          modelId,
          errorName: error.name,
          errorMessage: error.message,
          alternativeModels
        })

        throw `${JSON.stringify({
          success: false,
          error: 'Rate limit exceeded. Please try again with a different model.',
          suggestedModels: alternativeModels,
          message: error.message
        })}`
      }

      logger.error('Failed to generate image', {
        modelId,
        errorName: error.name,
        errorMessage: error.message
      })

      throw `${JSON.stringify({
        success: false,
        error: 'Failed to generate image',
        message: error.message
      })}`
    }
  }

  async retrieve(
    bedrock: BedrockService,
    toolInput: {
      knowledgeBaseId: string
      query: string
    }
  ): Promise<RetrieveResult> {
    const { knowledgeBaseId, query } = toolInput

    logger.debug('Retrieving from Knowledge Base', {
      knowledgeBaseId,
      query
    })

    try {
      logger.info('Calling Bedrock Knowledge Base', {
        knowledgeBaseId,
        queryLength: query.length
      })

      const result = await bedrock.retrieve({
        knowledgeBaseId,
        retrievalQuery: {
          text: query
        }
      })

      logger.info('Knowledge Base retrieval successful', {
        knowledgeBaseId,
        retrievalResultsCount: result.retrievalResults?.length || 0
      })

      if (result.retrievalResults?.length) {
        logger.debug('Retrieval results summary', {
          topResult: {
            sourceUri: result.retrievalResults[0].location?.type
              ? result.retrievalResults[0].location?.s3Location?.uri || 'unknown'
              : 'unknown',
            score: result.retrievalResults[0].score
          },
          resultsCount: result.retrievalResults.length
        })
      } else {
        logger.warn('Knowledge Base returned no results', {
          knowledgeBaseId,
          query
        })
      }

      return {
        success: true,
        name: 'retrieve',
        message: `Retrieved information from knowledge base ${knowledgeBaseId}`,
        result
      }
    } catch (error: any) {
      logger.error('Error retrieving from Knowledge Base', {
        knowledgeBaseId,
        query,
        error: error.message,
        errorName: error.name
      })

      throw `Error retrieve: ${JSON.stringify({
        success: false,
        name: 'retrieve',
        error: 'Failed to retrieve information from knowledge base',
        message: error.message
      })}`
    }
  }

  async invokeBedrockAgent(
    bedrock: BedrockService,
    projectPath: string,
    toolInput: {
      agentId: string
      agentAliasId: string
      sessionId?: string
      inputText: string
      file?: {
        filePath?: string
        useCase?: FileUseCase
      }
    }
  ): Promise<InvokeBedrockAgentResult> {
    const { agentId, agentAliasId, sessionId, inputText, file } = toolInput

    logger.debug('Invoking Bedrock Agent', {
      agentId,
      agentAliasId,
      sessionId: sessionId || 'new-session',
      hasFile: !!file,
      projectPath
    })

    try {
      // File processing correction
      let fileData: any = undefined
      if (file && file.filePath) {
        logger.debug('Processing file for agent invocation', {
          filePath: file.filePath,
          useCase: file.useCase
        })

        const fileContent = await fs.readFile(file.filePath)
        const filename = path.basename(file.filePath)
        const mimeType = getMimeType(file.filePath)

        logger.debug('File read successfully', {
          filename,
          mimeType,
          contentLength: fileContent.length
        })

        fileData = {
          files: [
            {
              name: filename,
              source: {
                sourceType: 'BYTE_CONTENT',
                byteContent: {
                  // CSV file case
                  mediaType: filename.endsWith('.csv') ? 'text/csv' : mimeType,
                  data: fileContent
                }
              },
              useCase: file.useCase
            }
          ]
        }
      }

      const command: InvokeAgentInput = {
        agentId,
        agentAliasId,
        sessionId,
        inputText,
        enableTrace: true,
        sessionState: fileData
      }

      logger.info('Calling Bedrock Agent service', {
        agentId,
        agentAliasId,
        inputTextLength: inputText.length,
        hasSessionId: !!sessionId,
        hasFileData: !!fileData
      })

      const result = await bedrock.invokeAgent(command)

      logger.info('Agent invocation successful', {
        agentId,
        sessionId: result.sessionId,
        hasCompletion: !!result.completion
      })

      let filePaths: string[] = []

      if (result.completion?.files?.length) {
        logger.debug('Processing files from agent result', {
          fileCount: result.completion.files.length
        })

        filePaths = await Promise.all(
          result.completion.files.map(async (file) => {
            const filePath = path.join(projectPath, file.name)
            try {
              await fs.writeFile(filePath, file.content)
              logger.debug('Created file from agent result', {
                filePath,
                contentLength: file.content.length
              })
              return filePath
            } catch (err) {
              logger.error('Failed to write file from agent result', {
                filePath,
                error: err instanceof Error ? err.message : String(err)
              })
              return filePath
            }
          })
        )

        logger.info('Created files from agent result', { fileCount: filePaths.length })
      }

      return {
        success: true,
        name: 'invokeBedrockAgent',
        message: `Invoked agent ${agentId} with alias ${agentAliasId}`,
        result: {
          ...result,
          completion: {
            ...result.completion,
            files: filePaths
          }
        }
      }
    } catch (error: any) {
      logger.error('Error invoking Bedrock Agent', {
        agentId,
        agentAliasId,
        error: error.message,
        errorName: error.name
      })

      throw `Error invoking agent: ${JSON.stringify({
        success: false,
        name: 'invokeBedrockAgent',
        error: 'Failed to invoke agent',
        message: error.message
      })}`
    }
  }

  /**
   * Think tool implementation
   * Think about a problem in detail, return a step-by-step thinking process
   */
  async think(thought: string): Promise<ThinkResult> {
    logger.debug('Using think tool', { queryLength: thought.length })

    try {
      logger.info('Thinking about:', {
        query: thought.substring(0, 100) + (thought.length > 100 ? '...' : '')
      })

      // This tool does not perform special processing, but allows Claude 3.7 Sonnet's extended thinking mode
      // to directly display the thinking process to the client
      // If the query is very complex, it explicitly indicates that a more detailed thinking process is needed

      return {
        success: true,
        name: 'think',
        message: 'Thinking process completed',
        result: {
          reasoning: thought
        }
      }
    } catch (error) {
      logger.error('Error in think tool', {
        error: error instanceof Error ? error.message : String(error),
        thought: thought.substring(0, 100) + (thought.length > 100 ? '...' : '')
      })

      throw new Error(
        `Error in think tool: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  async executeCommand(
    input: CommandInput | CommandStdinInput,
    config: CommandConfig
  ): Promise<ExecuteCommandResult> {
    logger.debug('Executing command', {
      input: JSON.stringify(input),
      config: JSON.stringify({
        allowedCommands: config.allowedCommands?.length || 0
      })
    })

    try {
      const commandService = this.getCommandService(config)
      let result

      if ('stdin' in input && 'pid' in input) {
        // Send standard input
        logger.info('Sending stdin to process', {
          pid: input.pid,
          stdinLength: input.stdin?.length || 0
        })

        result = await commandService.sendInput(input)

        logger.debug('Process stdin result', {
          pid: input.pid,
          exitCode: result.exitCode,
          hasStdout: !!result.stdout.length,
          hasStderr: !!result.stderr.length
        })
      } else if ('command' in input && 'cwd' in input) {
        // Execute new command
        logger.info('Executing new command', {
          command: input.command,
          cwd: input.cwd
        })

        result = await commandService.executeCommand(input)

        logger.debug('Command execution result', {
          pid: result.processInfo?.pid,
          exitCode: result.exitCode,
          hasStdout: !!result.stdout.length,
          hasStderr: !!result.stderr.length,
          requiresInput: result.requiresInput
        })
      } else {
        const errorMsg = 'Invalid input format'
        logger.warn(errorMsg, { input: JSON.stringify(input) })
        throw new Error(errorMsg)
      }

      logger.info('Command execution completed', {
        exitCode: result.exitCode,
        success: result.exitCode === 0,
        requiresInput: result.requiresInput || false
      })

      return {
        success: true,
        name: 'executeCommand',
        message: `Command executed: ${JSON.stringify(input)}`,
        ...result
      }
    } catch (error) {
      logger.error('Error executing command', {
        error: error instanceof Error ? error.message : 'Unknown error',
        input: JSON.stringify(input)
      })

      throw JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      })
    }
  }
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.wasm': 'application/wasm'
  }

  return mimeTypes[ext] || 'application/octet-stream'
}
