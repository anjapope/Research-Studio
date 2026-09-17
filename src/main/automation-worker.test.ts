import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { DATA_ROOT_ENV, DRY_RUN_ENV, loadWorkerConfig } from './automation-config'
import { manifestPath, processingJobPath, sharedFolderPath, sharedPath } from './automation-fs'
import { emptyJobsManifest, enqueueJob, transitionJob, type JobRecord } from './automation-manifest'
import { scanInbox } from './automation-worker'

const paths: string[] = []

function temporary(name = 'research-studio-worker-'): string {
  const path = mkdtempSync(join(tmpdir(), name))
  paths.push(path)
  return path
}

afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('automation worker foundation', () => {
  it('loads shared-folder configuration from environment or JSON with dry-run enabled by default', () => {
    const root = temporary()
    expect(loadWorkerConfig({ env: { [DATA_ROOT_ENV]: root } })).toEqual({
      sharedDataRoot: root,
      dryRun: true
    })
    expect(loadWorkerConfig({ env: { [DATA_ROOT_ENV]: root, [DRY_RUN_ENV]: 'false' } })).toEqual({
      sharedDataRoot: root,
      dryRun: false
    })

    const configPath = join(root, 'worker.json')
    writeFileSync(configPath, JSON.stringify({ sharedDataRoot: root, dryRun: false }))
    expect(loadWorkerConfig({ env: {}, configPath })).toEqual({
      sharedDataRoot: root,
      dryRun: false
    })
    expect(() => loadWorkerConfig({ env: {} })).toThrow(`Set ${DATA_ROOT_ENV}`)
  })

  it('keeps shared-folder paths under the configured root', () => {
    const root = temporary()
    expect(sharedFolderPath(root, 'processingQueued')).toBe(join(root, 'Processing', 'Queued'))
    expect(processingJobPath(root, 'queued', 'job-abc')).toBe(
      join(root, 'Processing', 'Queued', 'job-abc.json')
    )
    expect(() => sharedPath(root, '..', 'outside')).toThrow('escaped the configured')
  })

  it('dry-runs inbox scans without creating manifests, logs, or processing files', () => {
    const root = temporary()
    const inbox = sharedFolderPath(root, 'inbox')
    writeFileSync(join(root, 'loose.txt'), 'not in inbox')
    mkdirSync(inbox, { recursive: true })
    writeFileSync(join(inbox, 'paper.txt'), 'field notes')
    const manifest = manifestPath(root, 'files.json')
    rmSync(manifest, { force: true })

    const result = scanInbox({ sharedDataRoot: root, dryRun: true })

    expect(result).toMatchObject({ dryRun: true, scannedFiles: 1, newFiles: 1, queuedJobs: 1 })
    expect(existsSync(manifest)).toBe(false)
    expect(existsSync(manifestPath(root, 'jobs.json'))).toBe(false)
    expect(existsSync(sharedFolderPath(root, 'systemLogs'))).toBe(false)
    expect(
      existsSync(
        processingJobPath(
          root,
          'queued',
          result.actions.find((action) => action.type === 'queue-job')!.id!
        )
      )
    ).toBe(false)
  })

  it('creates and updates manifests without duplicating repeated inbox files', () => {
    const root = temporary()
    scanInbox({ sharedDataRoot: root, dryRun: false })
    const inboxFile = join(sharedFolderPath(root, 'inbox'), 'source.md')
    writeFileSync(inboxFile, '# Source')

    const first = scanInbox({ sharedDataRoot: root, dryRun: false })
    const second = scanInbox({ sharedDataRoot: root, dryRun: false })
    const files = JSON.parse(readFileSync(manifestPath(root, 'files.json'), 'utf8')) as {
      files: unknown[]
    }
    const jobs = JSON.parse(readFileSync(manifestPath(root, 'jobs.json'), 'utf8')) as {
      jobs: JobRecord[]
    }

    expect(first).toMatchObject({ scannedFiles: 1, newFiles: 1, queuedJobs: 1 })
    expect(second).toMatchObject({ scannedFiles: 1, newFiles: 0, queuedJobs: 0 })
    expect(files.files).toHaveLength(1)
    expect(jobs.jobs).toHaveLength(1)
    expect(jobs.jobs[0].outputLocation).toBeNull()
    expect(existsSync(processingJobPath(root, 'queued', jobs.jobs[0].id))).toBe(true)
  })

  it('supports valid job-state transitions and rejects invalid transitions', () => {
    const manifest = emptyJobsManifest(new Date('2026-09-17T00:00:00.000Z'))
    const job: JobRecord = {
      id: 'job-test',
      sourceFileId: 'file-test',
      sourcePath: '/tmp/source.pdf',
      jobType: 'extract-text',
      createdAt: '2026-09-17T00:00:00.000Z',
      updatedAt: '2026-09-17T00:00:00.000Z',
      status: 'queued',
      outputLocation: '/tmp/output.json',
      error: null
    }
    enqueueJob(manifest, job)

    transitionJob(manifest, 'job-test', 'working', { now: new Date('2026-09-17T00:01:00.000Z') })
    expect(manifest.jobs[0].status).toBe('working')
    transitionJob(manifest, 'job-test', 'failed', {
      now: new Date('2026-09-17T00:02:00.000Z'),
      errorMessage: 'Parser failed'
    })
    expect(manifest.jobs[0]).toMatchObject({
      status: 'failed',
      error: { message: 'Parser failed' }
    })
    transitionJob(manifest, 'job-test', 'queued', { now: new Date('2026-09-17T00:03:00.000Z') })
    expect(() => transitionJob(manifest, 'job-test', 'complete')).toThrow('Cannot transition')
  })
})
