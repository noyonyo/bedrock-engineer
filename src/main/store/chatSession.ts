import path from 'path'
import fs from 'fs'
import Store from 'electron-store'
import { ChatSession, ChatMessage, SessionMetadata } from '../../types/chat/history'
import { store } from '../../preload/store'

export class ChatSessionManager {
  private readonly sessionsDir: string
  private metadataStore: Store<{
    activeSessionId?: string
    recentSessions: string[]
    metadata: { [key: string]: SessionMetadata }
  }>

  constructor() {
    const userDataPath = store.get('userDataPath')
    if (!userDataPath) {
      throw new Error('userDataPath is not set in store')
    }

    // Create directory for storing session files
    this.sessionsDir = path.join(userDataPath, 'chat-sessions')
    fs.mkdirSync(this.sessionsDir, { recursive: true })

    // Initialize metadata store
    this.metadataStore = new Store({
      name: 'chat-sessions-meta',
      defaults: {
        recentSessions: [] as string[],
        metadata: {} as { [key: string]: SessionMetadata }
      }
    })

    // On first launch or when metadata is empty, generate metadata from existing sessions
    this.initializeMetadata()
  }

  private initializeMetadata(): void {
    const metadata = this.metadataStore.get('metadata')
    if (Object.keys(metadata).length === 0) {
      try {
        const files = fs.readdirSync(this.sessionsDir)
        const sessionFiles = files.filter((file) => file.endsWith('.json'))

        for (const file of sessionFiles) {
          const sessionId = file.replace('.json', '')
          const session = this.readSessionFile(sessionId)
          if (session) {
            this.updateMetadata(sessionId, session)
          }
        }

        console.log('Metadata initialized successfully')
      } catch (error) {
        console.error('Error initializing metadata:', error)
      }
    }
  }

  private getSessionFilePath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.json`)
  }

  private readSessionFile(sessionId: string): ChatSession | null {
    const filePath = this.getSessionFilePath(sessionId)
    try {
      const data = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(data) as ChatSession
    } catch (error) {
      console.error(`Error reading session file ${sessionId}:`, error)
      return null
    }
  }

  private async writeSessionFile(sessionId: string, session: ChatSession): Promise<void> {
    const filePath = this.getSessionFilePath(sessionId)
    try {
      await fs.promises.writeFile(filePath, JSON.stringify(session, null, 2))
    } catch (error) {
      console.error(`Error writing session file ${sessionId}:`, error)
    }
  }

  private updateMetadata(sessionId: string, session: ChatSession): void {
    const metadata: SessionMetadata = {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
      agentId: session.agentId,
      modelId: session.modelId,
      systemPrompt: session.systemPrompt
    }

    const current = this.metadataStore.get('metadata')
    this.metadataStore.set('metadata', {
      ...current,
      [sessionId]: metadata
    })
  }

  async createSession(agentId: string, modelId: string, systemPrompt?: string): Promise<string> {
    const id = `session_${Date.now()}`
    const session: ChatSession = {
      id,
      title: `Chat ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      agentId,
      modelId,
      systemPrompt
    }

    await this.writeSessionFile(id, session)
    this.updateMetadata(id, session)
    this.updateRecentSessions(id)
    return id
  }

  async addMessage(sessionId: string, message: ChatMessage): Promise<void> {
    const session = this.readSessionFile(sessionId)
    if (!session) return

    session.messages.push(message)
    session.updatedAt = Date.now()

    await this.writeSessionFile(sessionId, session)
    this.updateMetadata(sessionId, session)
    this.updateRecentSessions(sessionId)
  }

  getSession(sessionId: string): ChatSession | null {
    return this.readSessionFile(sessionId)
  }

  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    const session = this.readSessionFile(sessionId)
    if (!session) return

    session.title = title
    session.updatedAt = Date.now()

    await this.writeSessionFile(sessionId, session)
    this.updateMetadata(sessionId, session)
  }

  deleteSession(sessionId: string): void {
    const filePath = this.getSessionFilePath(sessionId)
    try {
      fs.unlinkSync(filePath)

      // Delete from metadata as well
      const metadata = this.metadataStore.get('metadata')
      delete metadata[sessionId]
      this.metadataStore.set('metadata', metadata)
    } catch (error) {
      console.error(`Error deleting session file ${sessionId}:`, error)
    }

    const recentSessions = this.metadataStore.get('recentSessions')
    this.metadataStore.set(
      'recentSessions',
      recentSessions.filter((id) => id !== sessionId)
    )
  }

  deleteAllSessions(): void {
    try {
      // Delete all JSON files in the session directory
      const files = fs.readdirSync(this.sessionsDir)
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.sessionsDir, file)
          fs.unlinkSync(filePath)
        }
      }

      // Reset metadata
      this.metadataStore.set('metadata', {})
      this.metadataStore.set('recentSessions', [])
      this.metadataStore.delete('activeSessionId')

      console.log('All sessions have been deleted successfully')
    } catch (error) {
      console.error('Error deleting all sessions:', error)
    }
  }

  private updateRecentSessions(sessionId: string): void {
    const recentSessions = this.metadataStore.get('recentSessions')
    const updated = [sessionId, ...recentSessions.filter((id) => id !== sessionId)].slice(0, 10)
    this.metadataStore.set('recentSessions', updated)
  }

  getRecentSessions(): SessionMetadata[] {
    const recentIds = this.metadataStore.get('recentSessions')
    const metadata = this.metadataStore.get('metadata')
    return recentIds
      .map((id) => metadata[id])
      .filter((meta): meta is SessionMetadata => {
        if (!meta) return false
        // Verify that the session file actually exists
        const filePath = this.getSessionFilePath(meta.id)
        return fs.existsSync(filePath)
      })
      .filter((meta) => meta.messageCount > 0)
  }

  getAllSessionMetadata(): SessionMetadata[] {
    const metadata = this.metadataStore.get('metadata')
    return Object.values(metadata)
      .filter((meta) => {
        // Verify that metadata exists and corresponding file exists
        const filePath = this.getSessionFilePath(meta.id)
        return fs.existsSync(filePath)
      })
      .filter((meta) => meta.messageCount > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  setActiveSession(sessionId: string | undefined): void {
    this.metadataStore.set('activeSessionId', sessionId)
  }

  getActiveSessionId(): string | undefined {
    return this.metadataStore.get('activeSessionId')
  }

  async updateMessageContent(
    sessionId: string,
    messageIndex: number,
    updatedMessage: ChatMessage
  ): Promise<void> {
    const session = this.readSessionFile(sessionId)
    if (!session) return

    // Check if the specified index is within valid range
    if (messageIndex < 0 || messageIndex >= session.messages.length) {
      console.error(`Invalid message index: ${messageIndex}`)
      return
    }

    // Update the message
    session.messages[messageIndex] = updatedMessage
    session.updatedAt = Date.now()

    // Update file and metadata
    await this.writeSessionFile(sessionId, session)
    this.updateMetadata(sessionId, session)
  }

  async deleteMessage(sessionId: string, messageIndex: number): Promise<void> {
    const session = this.readSessionFile(sessionId)
    if (!session) return

    // Check if the specified index is within valid range
    if (messageIndex < 0 || messageIndex >= session.messages.length) {
      console.error(`Invalid message index: ${messageIndex}`)
      return
    }

    // Delete the message
    session.messages.splice(messageIndex, 1)
    session.updatedAt = Date.now()

    // Update file and metadata
    await this.writeSessionFile(sessionId, session)
    this.updateMetadata(sessionId, session)
  }
}
