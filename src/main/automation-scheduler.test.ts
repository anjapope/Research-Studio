import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { sharedFolderPath } from './automation-fs'
import {
  runWorkerSchedule,
  type WorkerSchedulerConfig,
  workerScheduleStatus
} from './automation-scheduler'

const paths: string[] = []

function temporary(): string {
  const path = mkdtempSync(join(tmpdir(), 'research-studio-scheduler-'))
  paths.push(path)
  return path
}

function config(
  root: string,
  overrides: Partial<WorkerSchedulerConfig> = {}
): WorkerSchedulerConfig {
  return {
    sharedDataRoot: root,
    enabled: true,
    intervalMinutes: 15,
    maxJobsPerRun: 1,
    staleLockMinutes: 5,
    logRetentionDays: 2,
    label: 'studio.research.worker.test',
    ...overrides
  }
}

function schedulerLock(root: string): string {
  return join(sharedFolderPath(root, 'systemConfig'), 'worker-scheduler.lock')
}

afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('worker scheduler', () => {
  it('is disabled and unavailable without touching shared content', async () => {
    const root = temporary()
    expect(await runWorkerSchedule(config(root, { enabled: false }))).toMatchObject({
      status: 'skipped-disabled'
    })
    expect(existsSync(join(root, 'System'))).toBe(false)
    expect(await runWorkerSchedule(config(join(root, 'missing')))).toMatchObject({
      status: 'unavailable'
    })
  })

  it('scans then processes a bounded number of jobs across repeated runs without changing Inbox originals', async () => {
    const root = temporary()
    const inbox = sharedFolderPath(root, 'inbox')
    mkdirSync(inbox, { recursive: true })
    writeFileSync(join(inbox, 'first.txt'), 'first original')
    writeFileSync(join(inbox, 'second.md'), '# second original')

    const first = await runWorkerSchedule(config(root))
    const second = await runWorkerSchedule(config(root))

    expect(first).toMatchObject({ status: 'complete', queuedJobs: 2, processedJobs: 1 })
    expect(second).toMatchObject({ status: 'complete', processedJobs: 1 })
    expect(readFileSync(join(inbox, 'first.txt'), 'utf8')).toBe('first original')
    expect(readFileSync(join(inbox, 'second.md'), 'utf8')).toBe('# second original')
    expect(existsSync(join(sharedFolderPath(root, 'processingComplete')))).toBe(true)
    expect(workerScheduleStatus(config(root))).toMatchObject({ rootAvailable: true, lock: 'none' })
  })

  it('skips a live overlap and safely recovers a stale interrupted lock', async () => {
    const root = temporary()
    const inbox = sharedFolderPath(root, 'inbox')
    mkdirSync(inbox, { recursive: true })
    writeFileSync(join(inbox, 'locked.txt'), 'lock test')
    const lock = schedulerLock(root)
    mkdirSync(sharedFolderPath(root, 'systemConfig'), { recursive: true })
    writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))

    expect(await runWorkerSchedule(config(root))).toMatchObject({ status: 'skipped-overlap' })
    expect(existsSync(lock)).toBe(true)

    writeFileSync(lock, JSON.stringify({ pid: 999_999, startedAt: '2020-01-01T00:00:00.000Z' }))
    utimesSync(lock, new Date('2020-01-01T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z'))
    expect(workerScheduleStatus(config(root))).toMatchObject({ lock: 'stale' })
    expect(await runWorkerSchedule(config(root))).toMatchObject({
      status: 'complete',
      processedJobs: 1
    })
    expect(existsSync(lock)).toBe(false)
  })

  it('retains only recent timestamped scheduler logs', async () => {
    const root = temporary()
    const inbox = sharedFolderPath(root, 'inbox')
    mkdirSync(inbox, { recursive: true })
    writeFileSync(join(inbox, 'log.txt'), 'log')
    const logs = sharedFolderPath(root, 'systemLogs')
    mkdirSync(logs, { recursive: true })
    const oldLog = join(logs, 'scheduler-2020-01-01.jsonl')
    writeFileSync(oldLog, '{"old":true}\n')
    utimesSync(oldLog, new Date('2020-01-01T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z'))

    await runWorkerSchedule(config(root, { logRetentionDays: 1 }))

    expect(existsSync(oldLog)).toBe(false)
    const today = join(logs, `scheduler-${new Date().toISOString().slice(0, 10)}.jsonl`)
    expect(readFileSync(today, 'utf8')).toContain('schedule-completed')
  })
})
