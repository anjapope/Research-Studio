import { createHash } from 'crypto'
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  writeFileSync
} from 'fs'
import { basename, dirname, extname } from 'path'
import type { WorkerConfig } from './automation-config'
import {
  ensureSharedFolderStructure,
  listInboxFiles,
  manifestPath,
  processingJobPath,
  workerLogPath
} from './automation-fs'
import {
  type FileMetadata,
  type JobRecord,
  enqueueJob,
  readFilesManifest,
  readJobsManifest,
  upsertFileMetadata,
  writeFilesManifest,
  writeJobsManifest
} from './automation-manifest'

export interface WorkerAction {
  type:
    'create-directory' | 'record-file' | 'queue-job' | 'write-manifest' | 'write-job' | 'write-log'
  path?: string
  id?: string
  reason: string
}

export interface ScanInboxResult {
  dryRun: boolean
  scannedFiles: number
  newFiles: number
  queuedJobs: number
  actions: WorkerAction[]
}

function sha256File(path: string): string {
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  const descriptor = openSync(path, 'r')
  try {
    let bytesRead = 0
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead))
    } while (bytesRead)
  } finally {
    closeSync(descriptor)
  }
  return hash.digest('hex')
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex')}`
}

function fileMetadata(path: string, now: Date): FileMetadata {
  const stats = statSync(path)
  const checksum = sha256File(path)
  return {
    id: stableId('file', `${path}\0${checksum}`),
    filename: basename(path),
    extension: extname(path).replace(/^\./, '').toLowerCase(),
    byteSize: stats.size,
    discoveredAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    modifiedAt: stats.mtime.toISOString(),
    sourcePath: path,
    sha256: checksum,
    processingStatus: 'queued',
    associatedProject: null
  }
}

function ingestionJob(file: FileMetadata, now: Date): JobRecord {
  return {
    id: stableId('job', `${file.id}\0ingest-inbox-file`),
    sourceFileId: file.id,
    sourcePath: file.sourcePath,
    jobType: 'ingest-inbox-file',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    queuedAt: now.toISOString(),
    status: 'queued',
    outputLocation: null,
    error: null
  }
}

function appendLog(root: string, entries: unknown[], now: Date): void {
  if (!entries.length) return
  const path = workerLogPath(root, now)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8')
}

export function scanInbox(config: WorkerConfig, now = new Date()): ScanInboxResult {
  const actions: WorkerAction[] = []
  const createdDirectories = ensureSharedFolderStructure(config.sharedDataRoot, config.dryRun)
  for (const path of createdDirectories) {
    actions.push({ type: 'create-directory', path, reason: 'Required shared-folder structure.' })
  }

  const files = listInboxFiles(config.sharedDataRoot)
  const filesPath = manifestPath(config.sharedDataRoot, 'files.json')
  const jobsPath = manifestPath(config.sharedDataRoot, 'jobs.json')
  const filesManifest = readFilesManifest(filesPath, now)
  const jobsManifest = readJobsManifest(jobsPath, now)
  const logEntries: unknown[] = []
  let newFiles = 0
  let queuedJobs = 0

  for (const path of files) {
    const metadata = fileMetadata(path, now)
    const upserted = upsertFileMetadata(filesManifest, metadata, now)
    if (upserted.created) newFiles += 1
    actions.push({
      type: 'record-file',
      path,
      id: upserted.entry.id,
      reason: upserted.created ? 'Discovered inbox file.' : 'Updated existing inbox file metadata.'
    })

    const jobId = stableId('job', `${upserted.entry.id}\0ingest-inbox-file`)
    const jobPath = processingJobPath(config.sharedDataRoot, 'queued', jobId)
    const queued = enqueueJob(jobsManifest, ingestionJob(upserted.entry, now), now)
    if (queued.created) queuedJobs += 1
    actions.push({
      type: 'queue-job',
      path: jobPath,
      id: queued.job.id,
      reason: queued.created ? 'Queued inbox ingestion job.' : 'Inbox ingestion job already exists.'
    })
    if (queued.created) {
      actions.push({
        type: 'write-job',
        path: jobPath,
        id: queued.job.id,
        reason: 'Persist queued job descriptor.'
      })
    }
    logEntries.push({
      at: now.toISOString(),
      event: upserted.created ? 'inbox.file.discovered' : 'inbox.file.seen',
      fileId: upserted.entry.id,
      jobId: queued.job.id,
      sourcePath: path,
      dryRun: config.dryRun
    })
  }

  actions.push({ type: 'write-manifest', path: filesPath, reason: 'Persist file manifest.' })
  actions.push({ type: 'write-manifest', path: jobsPath, reason: 'Persist job manifest.' })
  actions.push({
    type: 'write-log',
    path: workerLogPath(config.sharedDataRoot, now),
    reason: 'Record worker scan activity.'
  })

  if (!config.dryRun) {
    mkdirSync(dirname(filesPath), { recursive: true })
    writeFilesManifest(filesPath, filesManifest)
    writeJobsManifest(jobsPath, jobsManifest)
    for (const job of jobsManifest.jobs) {
      if (job.status !== 'queued') continue
      const jobPath = processingJobPath(config.sharedDataRoot, 'queued', job.id)
      mkdirSync(dirname(jobPath), { recursive: true })
      writeFileSync(jobPath, `${JSON.stringify(job, null, 2)}\n`, 'utf8')
    }
    appendLog(config.sharedDataRoot, logEntries, now)
  }

  return {
    dryRun: config.dryRun,
    scannedFiles: files.length,
    newFiles,
    queuedJobs,
    actions
  }
}
