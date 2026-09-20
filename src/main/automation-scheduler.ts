import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { join, resolve } from 'path'
import { z } from 'zod'
import { processQueuedJobs } from './automation-processor'
import { scanInbox } from './automation-worker'
import { sharedFolderPath } from './automation-fs'

const schedulerConfigSchema = z
  .object({
    sharedDataRoot: z.string().trim().min(1),
    enabled: z.boolean().default(false),
    intervalMinutes: z.number().int().min(5).max(1440).default(15),
    maxJobsPerRun: z.number().int().min(1).max(100).default(5),
    staleLockMinutes: z.number().int().min(5).max(1440).default(120),
    logRetentionDays: z.number().int().min(1).max(365).default(30),
    label: z
      .string()
      .regex(/^studio\.research\.worker(?:\.[a-z0-9-]+)?$/)
      .default('studio.research.worker')
  })
  .strict()

export type WorkerSchedulerConfig = z.infer<typeof schedulerConfigSchema>

export interface SchedulerRunResult {
  status: 'complete' | 'skipped-disabled' | 'skipped-overlap' | 'unavailable' | 'failed'
  scannedFiles: number
  queuedJobs: number
  processedJobs: number
  failedJobs: number
  message: string
}

interface SchedulerLock {
  pid: number
  startedAt: string
}

function schedulerLogPath(root: string, now: Date): string {
  return join(
    sharedFolderPath(root, 'systemLogs'),
    `scheduler-${now.toISOString().slice(0, 10)}.jsonl`
  )
}

function schedulerLockPath(root: string): string {
  return join(sharedFolderPath(root, 'systemConfig'), 'worker-scheduler.lock')
}

function appendSchedulerLog(
  root: string,
  now: Date,
  event: string,
  details: Record<string, unknown>
): void {
  const path = schedulerLogPath(root, now)
  mkdirSync(sharedFolderPath(root, 'systemLogs'), { recursive: true })
  appendFileSync(path, `${JSON.stringify({ at: now.toISOString(), event, ...details })}\n`, 'utf8')
}

function safelyAppendSchedulerLog(
  root: string,
  now: Date,
  event: string,
  details: Record<string, unknown>
): void {
  try {
    appendSchedulerLog(root, now, event, details)
  } catch {
    // The shared root may vanish during OneDrive reconciliation; preserve the primary result.
  }
}

function rootIsAvailable(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}

function processIsRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function acquireLock(
  root: string,
  config: WorkerSchedulerConfig,
  now: Date
): 'acquired' | 'overlap' {
  const path = schedulerLockPath(root)
  mkdirSync(sharedFolderPath(root, 'systemConfig'), { recursive: true })
  try {
    const descriptor = openSync(path, 'wx')
    try {
      writeFileSync(
        descriptor,
        `${JSON.stringify({ pid: process.pid, startedAt: now.toISOString() })}\n`,
        'utf8'
      )
    } finally {
      closeSync(descriptor)
    }
    return 'acquired'
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
  }
  const ageMs = now.getTime() - statSync(path).mtimeMs
  let lock: SchedulerLock | null = null
  try {
    lock = JSON.parse(readFileSync(path, 'utf8')) as SchedulerLock
  } catch {
    // A torn lock is only discarded after the same conservative age threshold.
  }
  const stale = ageMs > config.staleLockMinutes * 60_000 && (!lock || !processIsRunning(lock.pid))
  if (!stale) return 'overlap'
  unlinkSync(path)
  return acquireLock(root, config, now)
}

function releaseLock(root: string): void {
  const path = schedulerLockPath(root)
  if (existsSync(path)) unlinkSync(path)
}

function pruneSchedulerLogs(root: string, config: WorkerSchedulerConfig, now: Date): void {
  const directory = sharedFolderPath(root, 'systemLogs')
  if (!existsSync(directory)) return
  const threshold = now.getTime() - config.logRetentionDays * 86_400_000
  for (const name of readdirSync(directory)) {
    if (!/^scheduler-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue
    const path = join(directory, name)
    if (statSync(path).mtimeMs < threshold) rmSync(path, { force: true })
  }
}

export function loadWorkerSchedulerConfig(path: string): WorkerSchedulerConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(resolve(path), 'utf8'))
  } catch {
    throw new Error('Worker scheduler config must be valid JSON.')
  }
  const config = schedulerConfigSchema.parse(parsed)
  return { ...config, sharedDataRoot: resolve(config.sharedDataRoot) }
}

export async function runWorkerSchedule(
  config: WorkerSchedulerConfig,
  now = new Date()
): Promise<SchedulerRunResult> {
  if (!config.enabled) {
    return {
      status: 'skipped-disabled',
      scannedFiles: 0,
      queuedJobs: 0,
      processedJobs: 0,
      failedJobs: 0,
      message: 'Worker scheduling is disabled in its configuration.'
    }
  }
  if (!rootIsAvailable(config.sharedDataRoot)) {
    return {
      status: 'unavailable',
      scannedFiles: 0,
      queuedJobs: 0,
      processedJobs: 0,
      failedJobs: 0,
      message: 'The configured shared data root is unavailable.'
    }
  }
  let locked = false
  try {
    if (acquireLock(config.sharedDataRoot, config, now) === 'overlap') {
      safelyAppendSchedulerLog(config.sharedDataRoot, now, 'schedule-skipped-overlap', {})
      return {
        status: 'skipped-overlap',
        scannedFiles: 0,
        queuedJobs: 0,
        processedJobs: 0,
        failedJobs: 0,
        message: 'Another scheduled run still holds the lock.'
      }
    }
    locked = true
    safelyAppendSchedulerLog(config.sharedDataRoot, now, 'schedule-started', {
      maxJobsPerRun: config.maxJobsPerRun
    })
    const scan = scanInbox({ sharedDataRoot: config.sharedDataRoot, dryRun: false }, now)
    const processed = await processQueuedJobs(
      { sharedDataRoot: config.sharedDataRoot, dryRun: false },
      now,
      { maxJobs: config.maxJobsPerRun }
    )
    pruneSchedulerLogs(config.sharedDataRoot, config, now)
    safelyAppendSchedulerLog(config.sharedDataRoot, now, 'schedule-completed', {
      scannedFiles: scan.scannedFiles,
      queuedJobs: scan.queuedJobs,
      processedJobs: processed.completedJobs,
      failedJobs: processed.failedJobs
    })
    return {
      status: 'complete',
      scannedFiles: scan.scannedFiles,
      queuedJobs: scan.queuedJobs,
      processedJobs: processed.completedJobs,
      failedJobs: processed.failedJobs,
      message: 'Scheduled scan and bounded processing completed.'
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    safelyAppendSchedulerLog(config.sharedDataRoot, now, 'schedule-failed', { message })
    return {
      status: 'failed',
      scannedFiles: 0,
      queuedJobs: 0,
      processedJobs: 0,
      failedJobs: 0,
      message
    }
  } finally {
    if (locked) releaseLock(config.sharedDataRoot)
  }
}

export function workerScheduleStatus(config: WorkerSchedulerConfig): {
  enabled: boolean
  rootAvailable: boolean
  lock: 'none' | 'active' | 'stale'
} {
  const rootAvailable = rootIsAvailable(config.sharedDataRoot)
  if (!rootAvailable) return { enabled: config.enabled, rootAvailable: false, lock: 'none' }
  const path = schedulerLockPath(config.sharedDataRoot)
  if (!existsSync(path)) return { enabled: config.enabled, rootAvailable: true, lock: 'none' }
  try {
    const lock = JSON.parse(readFileSync(path, 'utf8')) as SchedulerLock
    return {
      enabled: config.enabled,
      rootAvailable: true,
      lock: processIsRunning(lock.pid) ? 'active' : 'stale'
    }
  } catch {
    return { enabled: config.enabled, rootAvailable: true, lock: 'stale' }
  }
}
