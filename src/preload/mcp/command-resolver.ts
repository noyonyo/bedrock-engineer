import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'

/**
 * Resolve the path of an executable command
 * TODO: Windows support and testing needed
 * TODO: Make PATH configuration controllable by the user
 * @param command Command name (e.g., uvx)
 * @returns Resolved command path
 */
export function resolveCommand(command: string): string {
  try {
    // 1. Use as is if it's an absolute path
    if (path.isAbsolute(command)) {
      if (fs.existsSync(command)) {
        return command
      }
    }

    // 2. Check common installation locations
    const commonPaths = [
      // Global npm package path
      '/usr/local/bin',
      '/opt/homebrew/bin',
      // Homebrew for Apple Silicon Mac
      '/opt/homebrew/bin',
      // Homebrew for Intel Mac
      '/usr/local/bin',
      // User's home directory bin
      path.join(os.homedir(), '.npm-global/bin'),
      path.join(os.homedir(), 'bin'),
      path.join(os.homedir(), '.local/bin')
    ]

    for (const dir of commonPaths) {
      try {
        const fullPath = path.join(dir, command)
        if (fs.existsSync(fullPath)) {
          return fullPath
        }
      } catch (err) {
        // Ignore error and try next path
      }
    }

    // 3. Search using which command on macOS/Linux
    if (process.platform !== 'win32') {
      try {
        const whichPath = execSync(`which ${command}`, { encoding: 'utf8' }).trim()
        if (whichPath && fs.existsSync(whichPath)) {
          return whichPath
        }
      } catch (err) {
        // Ignore if which command fails
      }
    }
  } catch (error) {
    console.error(`Error resolving command path for ${command}:`, error)
  }

  // Finally return the original command name
  return command
}
