export interface ContentChunk {
  index: number
  total: number
  content: string
  metadata?: {
    url?: string
    filePath?: string
    timestamp: number
  }
}

export class ContentChunker {
  private static readonly MAX_CHUNK_SIZE = 50000 // Approximately 50,000 characters (considering Claude 3 Haiku's limitations)

  static splitContent(
    content: string,
    metadata: { url?: string },
    option?: { cleaning?: boolean }
  ): ContentChunk[] {
    const chunks: ContentChunk[] = []
    const timestamp = Date.now()

    // Default value for option is false
    if (option?.cleaning) {
      content = this.extractMainContent(content)
    }

    // Split content into appropriate sizes
    const totalChunks = Math.ceil(content.length / this.MAX_CHUNK_SIZE)

    for (let i = 0; i < totalChunks; i++) {
      const start = i * this.MAX_CHUNK_SIZE
      const end = Math.min((i + 1) * this.MAX_CHUNK_SIZE, content.length)

      chunks.push({
        index: i + 1,
        total: totalChunks,
        content: content.slice(start, end),
        metadata: {
          ...metadata,
          timestamp
        }
      })
    }

    return chunks
  }

  public static extractMainContent(html: string): string {
    // Basic HTML cleaning
    const content = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove scripts
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '') // Remove styles
      .replace(/<[^>]+>/g, '\n') // Convert tags to newlines
      .replace(/&nbsp;/g, ' ') // Convert HTML entities
      .replace(/\s+/g, ' ') // Remove consecutive whitespace
      .trim()

    return content
  }
}
