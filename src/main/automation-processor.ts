import { createHash } from 'crypto'
import { copyFileSync, existsSync, readFileSync, renameSync, statSync } from 'fs'
import { basename, extname } from 'path'
import type { WorkerConfig } from './automation-config'
import {
  extractOutputPath,
  listProcessingJobPaths,
  manifestPath,
  preservedSourcePath,
  processingJobPath,
  workerLogPath,
  writeTextAtomic
} from './automation-fs'
import {
  type FileMetadata,
  type JobRecord,
  type JobsManifest,
  fileMetadataSchema,
  filesManifestSchema,
  jobRecordSchema,
  readFilesManifest,
  readJobsManifest,
  transitionJob,
  writeFilesManifest,
  writeJobsManifest
} from './automation-manifest'
import { extractDocument } from './automation-extractors'

const PROCESSOR_ID = 'research-studio-document-processor/1'

export interface ProcessingAction {
  type:
    | 'job-claimed'
    | 'source-preserved'
    | 'extraction-started'
    | 'extraction-completed'
    | 'extraction-needs-ocr'
    | 'job-completed'
    | 'job-failed'
    | 'write-output'
  jobId: string
  fileId: string
  path?: string
  reason: string
}

export interface ProcessQueuedResult {
  dryRun: boolean
  consideredJobs: number
  completedJobs: number
  failedJobs: number
  actions: ProcessingAction[]
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/u).length : 0
}

function safeCopySource(root: string, file: FileMetadata): string {
  const sourceType = file.extension === 'pdf' ? 'pdf' : 'data'
  const preferred = preservedSourcePath(root, sourceType, file.filename)
  if (!existsSync(preferred) || sha256File(preferred) === file.sha256) return preferred
  const extension = extname(file.filename)
  const stem = basename(file.filename, extension)
  return preservedSourcePath(root, sourceType, `${stem}-${file.id}${extension}`)
}

function preserveSource(root: string, file: FileMetadata): string {
  const destination = safeCopySource(root, file)
  if (!existsSync(destination)) copyFileSync(file.sourcePath, destination)
  else if (sha256File(destination) !== file.sha256) {
    throw new Error('Preserved source collision could not be resolved safely.')
  }
  return destination
}

function readJob(path: string): JobRecord {
  return jobRecordSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}

function writeJob(path: string, job: JobRecord): void {
  writeTextAtomic(path, `${JSON.stringify(job, null, 2)}\n`)
}

function moveJobDescriptor(root: string, job: JobRecord, from: string, status: string): string {
  const destination = processingJobPath(root, status, job.id)
  writeJob(from, job)
  renameSync(from, destination)
  return destination
}

function logEvent(root: string, now: Date, event: string, job: JobRecord, extra = {}): void {
  const path = workerLogPath(root, now)
  const line = JSON.stringify({
    at: now.toISOString(),
    event,
    jobId: job.id,
    fileId: job.sourceFileId,
    sourcePath: job.sourcePath,
    ...extra
  })
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  writeTextAtomic(path, `${existing}${line}\n`)
}

function updateFile(
  files: FileMetadata[],
  file: FileMetadata,
  updates: Partial<FileMetadata>
): FileMetadata {
  const index = files.findIndex((item) => item.id === file.id)
  if (index < 0) throw new Error(`File not found in manifest: ${file.id}`)
  const updated = fileMetadataSchema.parse({ ...file, ...updates })
  files[index] = updated
  return updated
}

function persistManifests(root: string, files: FileMetadata[], jobs: JobsManifest): void {
  const filesManifest = filesManifestSchema.parse({
    format: 'research-studio-file-manifest',
    version: 1,
    updatedAt: new Date().toISOString(),
    files
  })
  writeFilesManifest(manifestPath(root, 'files.json'), filesManifest)
  writeJobsManifest(manifestPath(root, 'jobs.json'), jobs)
}

async function processJob(
  root: string,
  files: FileMetadata[],
  jobs: JobsManifest,
  queuedPath: string,
  config: WorkerConfig,
  now: Date,
  actions: ProcessingAction[]
): Promise<'complete' | 'failed'> {
  const queuedJob = readJob(queuedPath)
  const job = jobs.jobs.find((item) => item.id === queuedJob.id)
  if (!job || job.status !== 'queued') return 'complete'
  const file = files.find((item) => item.id === job.sourceFileId)
  if (!file) throw new Error(`File metadata not found for job ${job.id}.`)
  const workingPath = processingJobPath(root, 'working', job.id)
  transitionJob(jobs, job.id, 'working', {
    now,
    processor: PROCESSOR_ID
  })
  job.inputLocation = file.sourcePath
  if (!config.dryRun) {
    persistManifests(root, files, jobs)
    moveJobDescriptor(root, job, queuedPath, 'working')
    logEvent(root, now, 'job-claimed', job)
  }
  actions.push({
    type: 'job-claimed',
    jobId: job.id,
    fileId: file.id,
    path: workingPath,
    reason: 'Moved queued job to Working.'
  })

  let preservedPath: string | null = null
  try {
    if (sha256File(file.sourcePath) !== file.sha256) {
      throw new Error('The Inbox source changed after scanning; scan it again before processing.')
    }
    const preserved = config.dryRun
      ? safeCopySource(root, file)
      : file.preservedSourcePath && existsSync(file.preservedSourcePath)
        ? file.preservedSourcePath
        : preserveSource(root, file)
    preservedPath = preserved
    actions.push({
      type: 'source-preserved',
      jobId: job.id,
      fileId: file.id,
      path: preserved,
      reason: 'Preserved original source without modifying Inbox.'
    })
    if (!config.dryRun) {
      updateFile(files, file, { preservedSourcePath: preserved })
      persistManifests(root, files, jobs)
      logEvent(root, now, 'source-preserved', job, { preservedSourcePath: preserved })
    }

    actions.push({
      type: 'extraction-started',
      jobId: job.id,
      fileId: file.id,
      reason: `Extracting .${file.extension} source.`
    })
    if (!config.dryRun) logEvent(root, now, 'extraction-started', job)
    const extraction = await extractDocument(
      config.dryRun ? file.sourcePath : preserved,
      file.extension
    )
    const outputJson = extractOutputPath(root, file.id, 'json')
    const outputText = extractOutputPath(root, file.id, 'txt')
    const processedAt = now.toISOString()
    const metadata = {
      format: 'research-studio-extraction',
      version: 1,
      fileId: file.id,
      jobId: job.id,
      originalFilename: file.filename,
      originalSourcePath: file.sourcePath,
      preservedSourcePath: preserved,
      sha256: file.sha256,
      mimeType:
        file.extension === 'pdf'
          ? 'application/pdf'
          : file.extension === 'md'
            ? 'text/markdown'
            : 'text/plain',
      byteSize: statSync(file.sourcePath).size,
      ingestedAt: file.discoveredAt,
      processedAt,
      extractionStatus: extraction.extractionStatus,
      extractor: extraction.extractor,
      pageCount: extraction.pageCount,
      characterCount: extraction.text.length,
      wordCount: wordCount(extraction.text),
      normalizedText: extraction.text,
      outputLocation: outputJson,
      textOutputLocation: outputText,
      warnings: extraction.warnings,
      errors: []
    }
    actions.push({
      type:
        extraction.extractionStatus === 'needs-ocr'
          ? 'extraction-needs-ocr'
          : 'extraction-completed',
      jobId: job.id,
      fileId: file.id,
      path: outputJson,
      reason:
        extraction.extractionStatus === 'needs-ocr'
          ? 'No embedded PDF text was available.'
          : 'Extraction completed.'
    })
    if (!config.dryRun) {
      writeTextAtomic(outputJson, `${JSON.stringify(metadata, null, 2)}\n`)
      writeTextAtomic(outputText, extraction.text)
      const updatedFile = updateFile(files, file, {
        preservedSourcePath: preserved,
        processingStatus: 'complete',
        extractionStatus: extraction.extractionStatus,
        extractedTextPath: outputText,
        extractionRecordPath: outputJson,
        processedAt,
        processedBy: PROCESSOR_ID,
        processingJobId: job.id,
        warnings: extraction.warnings
      })
      Object.assign(file, updatedFile)
      transitionJob(jobs, job.id, 'complete', {
        now,
        outputLocation: outputJson,
        processor: PROCESSOR_ID,
        warnings: extraction.warnings
      })
      persistManifests(root, files, jobs)
      const completedPath = moveJobDescriptor(root, job, workingPath, 'complete')
      logEvent(
        root,
        now,
        extraction.extractionStatus === 'needs-ocr'
          ? 'extraction-needs-ocr'
          : 'extraction-completed',
        job,
        {
          outputLocation: outputJson,
          textOutputLocation: outputText
        }
      )
      logEvent(root, now, 'job-completed', job, { descriptorPath: completedPath })
    }
    return 'complete'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const safeMessage = message.replace(/(RESEARCH_STUDIO_DATA_ROOT=)[^\s]+/g, '$1[redacted]')
    if (!config.dryRun) {
      updateFile(files, file, {
        processingStatus: 'failed',
        preservedSourcePath: preservedPath,
        extractionStatus: safeMessage.startsWith('unsupported-file-type')
          ? 'unsupported-file-type'
          : 'failed',
        processedAt: now.toISOString(),
        processedBy: PROCESSOR_ID,
        processingJobId: job.id,
        warnings: []
      })
      transitionJob(jobs, job.id, 'failed', {
        now,
        processor: PROCESSOR_ID,
        errorMessage: safeMessage
      })
      persistManifests(root, files, jobs)
      moveJobDescriptor(root, job, workingPath, 'failed')
      logEvent(root, now, 'job-failed', job, { error: safeMessage })
    }
    actions.push({ type: 'job-failed', jobId: job.id, fileId: file.id, reason: safeMessage })
    return 'failed'
  }
}

export async function processQueuedJobs(
  config: WorkerConfig,
  now = new Date(),
  options: { maxJobs?: number } = {}
): Promise<ProcessQueuedResult> {
  const queuedPaths = listProcessingJobPaths(config.sharedDataRoot, 'queued')
  const filesManifest = readFilesManifest(manifestPath(config.sharedDataRoot, 'files.json'), now)
  const jobs = readJobsManifest(manifestPath(config.sharedDataRoot, 'jobs.json'), now)
  const actions: ProcessingAction[] = []
  let completedJobs = 0
  let failedJobs = 0
  const selectedPaths = queuedPaths.slice(0, options.maxJobs ?? queuedPaths.length)
  for (const queuedPath of selectedPaths) {
    try {
      const result = await processJob(
        config.sharedDataRoot,
        filesManifest.files,
        jobs,
        queuedPath,
        config,
        now,
        actions
      )
      if (result === 'complete') completedJobs += 1
      else failedJobs += 1
    } catch (error) {
      actions.push({
        type: 'job-failed',
        jobId: 'unknown',
        fileId: 'unknown',
        reason: error instanceof Error ? error.message : String(error)
      })
      failedJobs += 1
    }
  }
  return {
    dryRun: config.dryRun,
    consideredJobs: selectedPaths.length,
    completedJobs,
    failedJobs,
    actions
  }
}
