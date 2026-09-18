import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { resolve, sep } from 'path'
import { z } from 'zod'
import { loadWorkerConfig, type WorkerConfig } from './automation-config'
import { sharedFolderPath } from './automation-fs'
import {
  filesManifestSchema,
  jobsManifestSchema,
  type FileMetadata,
  type JobRecord
} from './automation-manifest'
import type {
  SharedWorkerDocument,
  SharedWorkerImportResult,
  SharedWorkerStatus
} from '../shared/domain'
import type { WorkerSourceImport, WorkspaceDatabase } from './database'

const extractionRecordSchema = z.object({
  extractionStatus: z.enum(['extracted', 'needs-ocr', 'failed']).nullable().optional(),
  normalizedText: z.string().optional(),
  extractor: z.string().nullable().optional(),
  pageCount: z.number().int().nullable().optional(),
  warnings: z.array(z.string()).optional(),
  outputLocation: z.string().nullable().optional(),
  textOutputLocation: z.string().nullable().optional()
})

interface SharedWorkerState {
  config: WorkerConfig
  files: FileMetadata[]
  jobs: JobRecord[]
}

export class SharedWorkerService {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  private config(): WorkerConfig | null {
    try {
      return loadWorkerConfig({ env: this.environment })
    } catch {
      return null
    }
  }

  status(): SharedWorkerStatus {
    const config = this.config()
    if (!config) {
      return {
        connection: 'not-configured',
        root: null,
        queuedJobs: 0,
        workingJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        processedFiles: 0,
        latestActivity: null,
        message: 'Set RESEARCH_STUDIO_DATA_ROOT to connect a shared worker workspace.'
      }
    }
    if (!existsSync(config.sharedDataRoot) || !statSync(config.sharedDataRoot).isDirectory()) {
      return this.emptyStatus(
        'unavailable',
        config.sharedDataRoot,
        'The shared worker folder is unavailable.'
      )
    }
    try {
      const state = this.readState(config)
      const latestActivity = this.latestActivity(config.sharedDataRoot)
      return {
        connection: 'connected',
        root: config.sharedDataRoot,
        queuedJobs: state.jobs.filter((job) => job.status === 'queued').length,
        workingJobs: state.jobs.filter((job) => job.status === 'working').length,
        completedJobs: state.jobs.filter((job) => job.status === 'complete').length,
        failedJobs: state.jobs.filter((job) => job.status === 'failed').length,
        processedFiles: state.files.filter((file) => file.processedAt).length,
        latestActivity,
        message: null
      }
    } catch (error) {
      return this.emptyStatus(
        'invalid-state',
        config.sharedDataRoot,
        error instanceof Error ? error.message : 'The shared worker state is invalid.'
      )
    }
  }

  documents(): SharedWorkerDocument[] {
    const config = this.config()
    if (!config) return []
    try {
      const state = this.readState(config)
      return state.files
        .map((file) => this.toDocument(config.sharedDataRoot, file, state.jobs))
        .sort((left, right) => (right.processedAt ?? '').localeCompare(left.processedAt ?? ''))
    } catch {
      return []
    }
  }

  importDocument(fileId: string, database: WorkspaceDatabase): SharedWorkerImportResult {
    const config = this.config()
    if (!config) return this.importFailure('Shared worker integration is not configured.')
    try {
      const state = this.readState(config)
      const file = state.files.find((item) => item.id === fileId)
      if (!file) return this.importFailure('The worker file was not found in the shared manifest.')
      const job = state.jobs.find((item) => item.sourceFileId === file.id) ?? null
      const document = this.toDocument(config.sharedDataRoot, file, state.jobs)
      if (document.jobStatus !== 'complete') {
        return this.importFailure('Only completed worker documents can be imported.')
      }
      if (
        !document.preservedSourcePath ||
        !this.safeExistingPath(config.sharedDataRoot, document.preservedSourcePath)
      ) {
        return this.importFailure('The preserved worker source is unavailable.')
      }
      const duplicate = database.findSourceByWorkerFileId(file.id)
      if (duplicate) {
        return {
          imported: false,
          duplicate: true,
          source: duplicate,
          message: 'This worker document is already in the library.'
        }
      }
      const record = this.readExtractionRecord(config.sharedDataRoot, file)
      const imported: WorkerSourceImport = {
        workerFileId: file.id,
        workerJobId: job?.id ?? null,
        originalName: file.filename,
        originalPath: file.sourcePath,
        preservedPath: document.preservedSourcePath,
        extractionPath: file.extractionRecordPath ?? null,
        extractionStatus: this.applicationExtractionStatus(file.extractionStatus),
        processedAt: file.processedAt ?? null,
        processor: file.processedBy ?? null,
        text: record?.normalizedText ?? null,
        extractor: record?.extractor ?? null,
        pageCount: record?.pageCount ?? null,
        warnings: record?.warnings ?? file.warnings ?? []
      }
      const source = database.saveSource({
        title: file.filename,
        sourceType: file.extension === 'pdf' ? 'report' : 'other',
        status: 'unread',
        authors: [],
        year: null,
        publicationTitle: null,
        publisher: null,
        doi: null,
        url: null,
        abstract: null,
        notes: record?.normalizedText ?? null,
        tags: ['worker-import'],
        origin: 'imported',
        provenanceNote: `Imported from Mayday 3 worker ${file.id}${job ? ` via job ${job.id}` : ''}.`
      })
      database.attachWorkerSource(source.id, document.preservedSourcePath, imported)
      return {
        imported: true,
        duplicate: false,
        source: database.getSource(source.id),
        message: 'Worker document imported into the library.'
      }
    } catch (error) {
      return this.importFailure(
        error instanceof Error ? error.message : 'The worker document could not be imported.'
      )
    }
  }

  private readState(config: WorkerConfig): SharedWorkerState {
    const manifestRoot = sharedFolderPath(config.sharedDataRoot, 'systemManifests')
    const files = filesManifestSchema.parse(
      JSON.parse(readFileSync(resolve(manifestRoot, 'files.json'), 'utf8'))
    ).files
    const jobs = jobsManifestSchema.parse(
      JSON.parse(readFileSync(resolve(manifestRoot, 'jobs.json'), 'utf8'))
    ).jobs
    for (const file of files) {
      this.safeManifestPath(config.sharedDataRoot, file.sourcePath)
      for (const path of [
        file.preservedSourcePath,
        file.extractedTextPath,
        file.extractionRecordPath
      ]) {
        if (path) this.safeManifestPath(config.sharedDataRoot, path)
      }
    }
    for (const job of jobs) this.safeManifestPath(config.sharedDataRoot, job.sourcePath)
    return { config, files, jobs }
  }

  private toDocument(root: string, file: FileMetadata, jobs: JobRecord[]): SharedWorkerDocument {
    const job = jobs.find((item) => item.sourceFileId === file.id) ?? null
    const preservedSourcePath = file.preservedSourcePath
      ? this.safeExistingPath(root, file.preservedSourcePath)
        ? file.preservedSourcePath
        : null
      : null
    const extractionRecordPath = file.extractionRecordPath
      ? this.safeExistingPath(root, file.extractionRecordPath)
        ? file.extractionRecordPath
        : null
      : null
    return {
      fileId: file.id,
      jobId: job?.id ?? file.processingJobId ?? null,
      filename: file.filename,
      extension: file.extension,
      byteSize: file.byteSize,
      sourcePath: this.safeManifestPath(root, file.sourcePath),
      preservedSourcePath,
      extractionStatus: this.applicationExtractionStatus(file.extractionStatus),
      extractedTextPath:
        file.extractedTextPath && this.safeExistingPath(root, file.extractedTextPath)
          ? file.extractedTextPath
          : null,
      extractionRecordPath,
      processedAt: file.processedAt ?? null,
      processor: file.processedBy ?? null,
      warnings: file.warnings ?? [],
      jobStatus:
        job?.status ??
        (file.processingStatus === 'complete'
          ? 'complete'
          : file.processingStatus === 'failed'
            ? 'failed'
            : file.processingStatus === 'working'
              ? 'working'
              : file.processingStatus === 'queued'
                ? 'queued'
                : null),
      jobError: job?.error?.message ?? null,
      importedSourceId: null
    }
  }

  private readExtractionRecord(
    root: string,
    file: FileMetadata
  ): z.infer<typeof extractionRecordSchema> | null {
    if (!file.extractionRecordPath || !this.safeExistingPath(root, file.extractionRecordPath))
      return null
    return extractionRecordSchema.parse(JSON.parse(readFileSync(file.extractionRecordPath, 'utf8')))
  }

  private applicationExtractionStatus(
    status: FileMetadata['extractionStatus']
  ): 'extracted' | 'needs-ocr' | 'failed' | null {
    if (status === 'extracted' || status === 'needs-ocr' || status === 'failed') return status
    if (status === 'unsupported-file-type') return 'failed'
    return null
  }

  private safeManifestPath(root: string, path: string): string {
    const candidate = resolve(path)
    const normalizedRoot = resolve(root)
    if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${sep}`)) {
      throw new Error('The shared worker manifest contains a path outside its configured root.')
    }
    return candidate
  }

  private safeExistingPath(root: string, path: string): boolean {
    const candidate = this.safeManifestPath(root, path)
    return existsSync(candidate) && statSync(candidate).isFile()
  }

  private latestActivity(root: string): string | null {
    const directory = sharedFolderPath(root, 'systemLogs')
    if (!existsSync(directory)) return null
    const latest = readdirSync(directory)
      .filter((name) => name.endsWith('.jsonl'))
      .sort()
      .at(-1)
    if (!latest) return null
    const lines = readFileSync(resolve(directory, latest), 'utf8').trim().split('\n')
    return lines.at(-1) ?? null
  }

  private emptyStatus(
    connection: SharedWorkerStatus['connection'],
    root: string,
    message: string
  ): SharedWorkerStatus {
    return {
      connection,
      root,
      queuedJobs: 0,
      workingJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      processedFiles: 0,
      latestActivity: null,
      message
    }
  }

  private importFailure(message: string): SharedWorkerImportResult {
    return { imported: false, duplicate: false, source: null, message }
  }
}
