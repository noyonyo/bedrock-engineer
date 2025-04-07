import { spawn } from 'child_process'
import {
  CommandConfig,
  CommandExecutionResult,
  CommandInput,
  CommandPattern,
  CommandStdinInput,
  DetachedProcessInfo,
  InputDetectionPattern,
  ProcessState,
  CommandPatternConfig
} from './types'

export class CommandService {
  private config: CommandConfig
  private runningProcesses: Map<number, DetachedProcessInfo> = new Map()
  private processStates: Map<number, ProcessState> = new Map()

  // Patterns to detect input waiting state
  private inputDetectionPatterns: InputDetectionPattern[] = [
    {
      pattern: /\? .+\?.*$/m, // inquirer style question
      promptExtractor: (output) => {
        const match = output.match(/\? (.+\?.*$)/m)
        return match ? match[1] : output
      }
    },
    {
      pattern: /[^:]+: $/m, // Basic prompt (e.g., "Enter name: ")
      promptExtractor: (output) => {
        const lines = output.split('\n')
        return lines[lines.length - 1]
      }
    }
  ]

  // Patterns indicating server startup state
  private serverReadyPatterns = [
    'listening',
    'ready',
    'started',
    'running',
    'live',
    'compiled successfully',
    'compiled',
    'waiting for file changes',
    'development server running'
  ]

  // Patterns indicating errors
  private errorPatterns = [
    'EADDRINUSE',
    'Error:',
    'error:',
    'ERR!',
    'app crashed',
    'Cannot find module',
    'command not found',
    'Failed to compile',
    'Syntax error:',
    'TypeError:'
  ]

  constructor(config: CommandConfig) {
    this.config = config
  }

  private parseCommandPattern(commandStr: string): CommandPattern {
    const parts = commandStr.split(' ')
    const hasWildcard = parts.some((part) => part === '*')

    return {
      command: parts[0],
      args: parts.slice(1),
      wildcard: hasWildcard
    }
  }

  private isCommandAllowed(commandToExecute: string): boolean {
    const executeParts = this.parseCommandPattern(commandToExecute)

    // Treat as empty array if allowedCommands is undefined
    const allowedCommands = this.config.allowedCommands || []

    return allowedCommands.some((allowedCmd) => {
      const allowedParts = this.parseCommandPattern(allowedCmd.pattern)

      if (allowedParts.command !== executeParts.command) {
        return false
      }

      if (allowedParts.wildcard) {
        return true
      }

      if (allowedParts.args.length !== executeParts.args.length) {
        return false
      }

      return allowedParts.args.every((arg, index) => {
        if (arg === '*') {
          return true
        }
        return arg === executeParts.args[index]
      })
    })
  }

  // Check if waiting for input
  private isWaitingForInput(output: string): { isWaiting: boolean; prompt?: string } {
    for (const pattern of this.inputDetectionPatterns) {
      if (output.match(pattern.pattern)) {
        const prompt = pattern.promptExtractor ? pattern.promptExtractor(output) : output
        return { isWaiting: true, prompt }
      }
    }
    return { isWaiting: false }
  }

  private initializeProcessState(pid: number): void {
    this.processStates.set(pid, {
      isRunning: true,
      hasError: false,
      output: {
        stdout: '',
        stderr: '',
        code: null
      }
    })
  }

  private updateProcessState(pid: number, updates: Partial<ProcessState>): void {
    const currentState = this.processStates.get(pid)
    if (currentState) {
      this.processStates.set(pid, { ...currentState, ...updates })
    }
  }

  // Check if server has started successfully
  private isServerReady(output: string): boolean {
    return this.serverReadyPatterns.some((pattern) =>
      output.toLowerCase().includes(pattern.toLowerCase())
    )
  }

  // Error checking
  private checkForErrors(stdout: string, stderr: string): boolean {
    // Check for error patterns
    if (
      this.errorPatterns.some((pattern) => stdout.includes(pattern) || stderr.includes(pattern))
    ) {
      return true
    }

    // Check for crash state
    if (stdout.includes('app crashed') && !stdout.includes('waiting for file changes')) {
      return true
    }

    return false
  }

  async executeCommand(input: CommandInput): Promise<CommandExecutionResult> {
    return new Promise((resolve, reject) => {
      if (!this.isCommandAllowed(input.command)) {
        reject(new Error(`Command not allowed: ${input.command}`))
        return
      }

      // Use configured shell
      const process = spawn(this.config.shell, ['-ic', input.command], {
        cwd: input.cwd,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      if (typeof process.pid === 'undefined') {
        console.log(process)
        reject(new Error('Failed to start process: PID is undefined'))
        return
      }

      const pid = process.pid

      // Initialize process information
      this.initializeProcessState(pid)
      this.runningProcesses.set(pid, {
        pid,
        command: input.command,
        timestamp: Date.now()
      })

      // Save process state
      this.updateProcessState(pid, { process })

      let currentOutput = ''
      let currentError = ''
      let isCompleted = false

      const cleanup = () => {
        this.runningProcesses.delete(pid)
        this.processStates.delete(pid)
      }

      const completeWithError = (error: string) => {
        if (!isCompleted) {
          isCompleted = true
          cleanup()
          reject(new Error(error))
        }
      }

      const completeWithSuccess = () => {
        if (!isCompleted) {
          const state = this.processStates.get(pid)
          if (!state) {
            reject(new Error('Process state not found'))
            return
          }

          // Check waiting state or development server state
          const { isWaiting, prompt } = this.isWaitingForInput(currentOutput)
          if (isWaiting) {
            resolve({
              stdout: currentOutput,
              stderr: currentError,
              exitCode: 0,
              processInfo: {
                pid,
                command: input.command,
                detached: true
              },
              requiresInput: true,
              prompt
            })
            return
          }

          // Check development server state
          if (this.isServerReady(currentOutput)) {
            resolve({
              stdout: currentOutput,
              stderr: currentError,
              exitCode: 0,
              processInfo: {
                pid,
                command: input.command,
                detached: true
              }
            })
            return
          }

          // Normal command completion
          isCompleted = true
          cleanup()
          resolve({
            stdout: currentOutput,
            stderr: currentError,
            exitCode: state.output.code || 0,
            processInfo: {
              pid,
              command: input.command,
              detached: true
            }
          })
        }
      }

      process.stdout.on('data', (data) => {
        const chunk = data.toString()
        currentOutput += chunk

        const state = this.processStates.get(pid)
        if (state) {
          this.updateProcessState(pid, {
            output: { ...state.output, stdout: currentOutput }
          })

          // Error checking
          if (this.checkForErrors(chunk, '')) {
            this.updateProcessState(pid, { hasError: true })
            completeWithError(`Command failed: \n${currentOutput}\n${currentError}`)
            return
          }

          // Check waiting state or development server state
          const { isWaiting } = this.isWaitingForInput(currentOutput)
          if (isWaiting || this.isServerReady(currentOutput)) {
            completeWithSuccess()
          }
        }
      })

      process.stderr.on('data', (data) => {
        const chunk = data.toString()
        currentError += chunk

        const state = this.processStates.get(pid)
        if (state) {
          this.updateProcessState(pid, {
            output: { ...state.output, stderr: currentError }
          })

          // Error checking
          if (this.checkForErrors('', chunk)) {
            this.updateProcessState(pid, { hasError: true })
            completeWithError(`Command failed: \n${currentOutput}\n${currentError}`)
          }
        }
      })

      process.on('error', (error) => {
        completeWithError(
          `Command execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      })

      process.on('exit', (code) => {
        const state = this.processStates.get(pid)
        if (state) {
          this.updateProcessState(pid, {
            isRunning: false,
            output: { ...state.output, code: code || 0 }
          })

          if (!this.checkForErrors(currentOutput, currentError) && code === 0) {
            completeWithSuccess()
          } else if (!isCompleted) {
            completeWithError(`Process exited with code ${code}\n${currentOutput}\n${currentError}`)
          }
        }
      })

      const TIMEOUT = 60000 * 5 // 5 minutes
      // Timeout processing
      setTimeout(() => {
        if (!isCompleted) {
          const state = this.processStates.get(pid)
          if (!state) return

          if (state.hasError) {
            completeWithError(`Command failed to start: \n${currentError}`)
          } else {
            // Check development server state
            if (
              this.isServerReady(currentOutput) ||
              currentOutput.includes('waiting for file changes')
            ) {
              completeWithSuccess()
            } else {
              completeWithError('Command timed out')
            }
          }
        }
      }, TIMEOUT) // Set longer for Multi-Agent processing
    })
  }

  async sendInput(input: CommandStdinInput): Promise<CommandExecutionResult> {
    const state = this.processStates.get(input.pid)
    if (!state || !state.process) {
      throw new Error(`No running process found with PID: ${input.pid}`)
    }

    return new Promise((resolve, reject) => {
      const { process } = state
      let currentOutput = state.output.stdout
      let currentError = state.output.stderr
      let isCompleted = false

      // Remove existing listeners
      process.stdout.removeAllListeners('data')
      process.stderr.removeAllListeners('data')
      process.removeAllListeners('error')
      process.removeAllListeners('exit')

      const completeWithError = (error: string) => {
        if (!isCompleted) {
          isCompleted = true
          reject(new Error(error))
        }
      }

      const completeWithSuccess = () => {
        if (!isCompleted) {
          isCompleted = true

          // Check waiting state
          const { isWaiting, prompt } = this.isWaitingForInput(currentOutput)

          resolve({
            stdout: currentOutput,
            stderr: currentError,
            exitCode: 0,
            processInfo: {
              pid: input.pid,
              command: state.process.spawnargs.join(' '),
              detached: true
            },
            requiresInput: isWaiting,
            prompt: isWaiting ? prompt : undefined
          })
        }
      }

      process.stdout.on('data', (data) => {
        const chunk = data.toString()
        currentOutput += chunk

        this.updateProcessState(input.pid, {
          output: { ...state.output, stdout: currentOutput }
        })

        // Error checking
        if (this.checkForErrors(chunk, '')) {
          this.updateProcessState(input.pid, { hasError: true })
          completeWithError(`Command failed: \n${currentOutput}\n${currentError}`)
          return
        }

        // Check waiting state or development server state
        const { isWaiting } = this.isWaitingForInput(currentOutput)
        if (isWaiting || this.isServerReady(currentOutput)) {
          completeWithSuccess()
        }
      })

      process.stderr.on('data', (data) => {
        const chunk = data.toString()
        currentError += chunk

        this.updateProcessState(input.pid, {
          output: { ...state.output, stderr: currentError }
        })

        if (this.checkForErrors('', chunk)) {
          this.updateProcessState(input.pid, { hasError: true })
          completeWithError(`Command failed: \n${currentOutput}\n${currentError}`)
        }
      })

      process.on('error', (error) => {
        completeWithError(
          `Command execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      })

      process.on('exit', (code) => {
        this.updateProcessState(input.pid, {
          isRunning: false,
          output: { ...state.output, code: code || 0 }
        })

        if (!this.checkForErrors(currentOutput, currentError) && code === 0) {
          completeWithSuccess()
        } else if (!isCompleted) {
          completeWithError(`Process exited with code ${code}\n${currentOutput}\n${currentError}`)
        }

        // Clean up after process ends
        this.runningProcesses.delete(input.pid)
        this.processStates.delete(input.pid)
      })

      // Send standard input
      process.stdin.write(input.stdin + '\n')

      // Timeout processing
      setTimeout(() => {
        if (!isCompleted) {
          const currentState = this.processStates.get(input.pid)
          if (!currentState) return

          if (currentState.hasError) {
            completeWithError(`Command failed: \n${currentError}`)
          } else if (
            this.isServerReady(currentOutput) ||
            currentOutput.includes('waiting for file changes')
          ) {
            completeWithSuccess()
          } else {
            completeWithError('Command timed out waiting for response')
          }
        }
      }, 5000)
    })
  }

  async stopProcess(pid: number): Promise<void> {
    const processInfo = this.runningProcesses.get(pid)
    if (processInfo) {
      try {
        process.kill(-pid) // Kill entire process group
        this.runningProcesses.delete(pid)
        this.processStates.delete(pid)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        throw new Error(`Failed to stop process ${pid}: ${errorMessage}`)
      }
    }
  }

  getRunningProcesses(): DetachedProcessInfo[] {
    return Array.from(this.runningProcesses.values())
  }

  getAllowedCommands(): CommandPatternConfig[] {
    return [...(this.config.allowedCommands || [])]
  }

  updateConfig(newConfig: CommandConfig): void {
    this.config = newConfig
  }
}
