import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  calls: [] as string[],
  teachingSettings: { credentials: vi.fn() }
}))

vi.mock('./workspace-lifecycle', () => ({
  WorkspaceLifecycle: class {
    close(): void {
      state.calls.push('lifecycle.close')
    }
  }
}))

vi.mock('./teaching-service', () => ({
  TeachingService: class {
    readonly teachingSettings = state.teachingSettings

    cancelTeachingSynthesis(): void {
      state.calls.push('teaching.cancel')
    }
  }
}))

vi.mock('./discovery-service', () => ({
  DiscoveryService: class {}
}))

vi.mock('./shared-worker-service', () => ({
  SharedWorkerService: class {}
}))

import { WorkspaceService } from './workspace-service'

describe('WorkspaceService integration', () => {
  it('cancels teaching before closing lifecycle-managed workspace state', () => {
    const service = new WorkspaceService()

    expect(service.teachingSettings).toBe(state.teachingSettings)
    service.close()

    expect(state.calls).toEqual(['teaching.cancel', 'lifecycle.close'])
  })
})
