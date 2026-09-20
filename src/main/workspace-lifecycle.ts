import { app, dialog } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import type { WorkspaceInfo } from '../shared/domain'
import { WorkspaceDatabase } from './database'

export class WorkspaceLifecycle {
  private database: WorkspaceDatabase | null = null
  private readonly preferencesPath = join(app.getPath('userData'), 'preferences.json')

  async choose(mode: 'create' | 'open'): Promise<WorkspaceInfo | null> {
    const result = await dialog.showOpenDialog({
      title:
        mode === 'create'
          ? 'Choose a folder for the new workspace'
          : 'Open a Research Studio workspace',
      properties: ['openDirectory', mode === 'create' ? 'createDirectory' : 'dontAddToRecent']
    })

    if (result.canceled || !result.filePaths[0]) return null
    return this.open(result.filePaths[0])
  }

  recent(): WorkspaceInfo | null {
    if (!existsSync(this.preferencesPath)) return null

    const parsed = JSON.parse(readFileSync(this.preferencesPath, 'utf8')) as {
      recentWorkspace?: unknown
    }

    if (typeof parsed.recentWorkspace !== 'string' || !existsSync(parsed.recentWorkspace)) {
      return null
    }

    return this.open(parsed.recentWorkspace)
  }

  open(path: string): WorkspaceInfo {
    this.close()

    const normalized = resolve(path)
    this.database = new WorkspaceDatabase(normalized)

    writeFileSync(
      this.preferencesPath,
      JSON.stringify({ recentWorkspace: normalized }, null, 2),
      'utf8'
    )

    return this.database.info()
  }

  close(): void {
    this.database?.close()
    this.database = null
  }

  activeDatabase(): WorkspaceDatabase | null {
    return this.database
  }

  requireDatabase(): WorkspaceDatabase {
    if (!this.database) {
      throw new Error('Open a workspace before managing sources.')
    }

    return this.database
  }
}
