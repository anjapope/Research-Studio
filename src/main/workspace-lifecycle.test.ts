import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join, resolve } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  openDialog: vi.fn(),
  userDataPath: '',
  instances: [] as Array<{
    workspacePath: string
    close: ReturnType<typeof vi.fn>
    info: () => {
      id: string
      name: string
      path: string
      createdAt: string
      sourceCount: number
    }
  }>
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => state.userDataPath)
  },
  dialog: {
    showOpenDialog: state.openDialog
  }
}))

vi.mock('./database', () => ({
  WorkspaceDatabase: class {
    readonly close = vi.fn()

    constructor(readonly workspacePath: string) {
      state.instances.push(this)
    }

    info(): {
      id: string
      name: string
      path: string
      createdAt: string
      sourceCount: number
    } {
      return {
        id: `workspace-${state.instances.indexOf(this) + 1}`,
        name: basename(this.workspacePath),
        path: this.workspacePath,
        createdAt: '2026-09-19T00:00:00.000Z',
        sourceCount: 0
      }
    }
  }
}))

import { WorkspaceLifecycle } from './workspace-lifecycle'

const tempRoots: string[] = []

function createTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

afterEach(() => {
  vi.clearAllMocks()
  state.openDialog.mockReset()
  state.instances.length = 0
  state.userDataPath = ''
  while (tempRoots.length) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true })
  }
})

describe('WorkspaceLifecycle', () => {
  it('opens a workspace, exposes the active database, and persists the recent workspace preference', () => {
    const root = createTempRoot('workspace-lifecycle-open-')
    const workspacePath = join(root, 'workspace')
    const userDataPath = join(root, 'user-data')
    mkdirSync(workspacePath)
    mkdirSync(userDataPath)
    state.userDataPath = userDataPath

    const lifecycle = new WorkspaceLifecycle()
    const info = lifecycle.open(join(root, 'workspace', '..', 'workspace'))

    expect(info).toEqual({
      id: 'workspace-1',
      name: 'workspace',
      path: resolve(workspacePath),
      createdAt: '2026-09-19T00:00:00.000Z',
      sourceCount: 0
    })
    expect(lifecycle.requireDatabase()).toBe(state.instances[0])
    expect(readFileSync(join(userDataPath, 'preferences.json'), 'utf8')).toContain(
      JSON.stringify(resolve(workspacePath))
    )
  })

  it('throws when no workspace is open and closes the active workspace cleanly', () => {
    const root = createTempRoot('workspace-lifecycle-close-')
    const workspacePath = join(root, 'workspace')
    const userDataPath = join(root, 'user-data')
    mkdirSync(workspacePath)
    mkdirSync(userDataPath)
    state.userDataPath = userDataPath

    const lifecycle = new WorkspaceLifecycle()

    expect(lifecycle.activeDatabase()).toBeNull()
    expect(() => lifecycle.requireDatabase()).toThrow('Open a workspace before managing sources.')

    lifecycle.open(workspacePath)
    const database = state.instances[0]
    expect(lifecycle.activeDatabase()).toBe(database)
    lifecycle.close()

    expect(database?.close).toHaveBeenCalledTimes(1)
    expect(lifecycle.activeDatabase()).toBeNull()
    expect(() => lifecycle.requireDatabase()).toThrow('Open a workspace before managing sources.')
  })

  it('replaces the active workspace and closes the previous database before switching', () => {
    const root = createTempRoot('workspace-lifecycle-switch-')
    const firstWorkspacePath = join(root, 'workspace-a')
    const secondWorkspacePath = join(root, 'workspace-b')
    const userDataPath = join(root, 'user-data')
    mkdirSync(firstWorkspacePath)
    mkdirSync(secondWorkspacePath)
    mkdirSync(userDataPath)
    state.userDataPath = userDataPath

    const lifecycle = new WorkspaceLifecycle()

    lifecycle.open(firstWorkspacePath)
    const firstDatabase = state.instances[0]
    lifecycle.open(secondWorkspacePath)

    expect(firstDatabase?.close).toHaveBeenCalledTimes(1)
    expect(state.instances).toHaveLength(2)
    expect(lifecycle.requireDatabase()).toBe(state.instances[1])
    expect(state.instances[1]?.info().path).toBe(resolve(secondWorkspacePath))
  })

  it('reopens a valid recent workspace from the existing preference file', () => {
    const root = createTempRoot('workspace-lifecycle-recent-')
    const workspacePath = join(root, 'workspace')
    const userDataPath = join(root, 'user-data')
    mkdirSync(workspacePath)
    mkdirSync(userDataPath)
    state.userDataPath = userDataPath

    const firstLifecycle = new WorkspaceLifecycle()
    firstLifecycle.open(workspacePath)
    firstLifecycle.close()

    state.instances.length = 0
    const secondLifecycle = new WorkspaceLifecycle()
    const reopened = secondLifecycle.recent()

    expect(reopened).toMatchObject({ path: resolve(workspacePath), name: 'workspace' })
    expect(secondLifecycle.requireDatabase()).toBe(state.instances[0])
  })

  it('uses the existing dialog flow when choosing a workspace', async () => {
    const root = createTempRoot('workspace-lifecycle-choose-')
    const workspacePath = join(root, 'workspace')
    const userDataPath = join(root, 'user-data')
    mkdirSync(workspacePath)
    mkdirSync(userDataPath)
    state.userDataPath = userDataPath
    state.openDialog.mockResolvedValue({ canceled: false, filePaths: [workspacePath] })

    const lifecycle = new WorkspaceLifecycle()
    const opened = await lifecycle.choose('create')

    expect(state.openDialog).toHaveBeenCalledWith({
      title: 'Choose a folder for the new workspace',
      properties: ['openDirectory', 'createDirectory']
    })
    expect(opened).toMatchObject({ path: resolve(workspacePath), name: 'workspace' })
  })
})
