import { existsSync, readFileSync, writeFileSync } from 'fs'
import { z } from 'zod'

export const fileProcessingStatuses = [
  'discovered',
  'queued',
  'working',
  'complete',
  'failed'
] as const
export const jobStatuses = ['queued', 'working', 'complete', 'failed'] as const

export type FileProcessingStatus = (typeof fileProcessingStatuses)[number]
export type JobStatus = (typeof jobStatuses)[number]

export const fileMetadataSchema = z.object({
  id: z.string().min(1),
  filename: z.string().min(1),
  extension: z.string(),
  byteSize: z.number().int().min(0),
  discoveredAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  modifiedAt: z.iso.datetime(),
  sourcePath: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  processingStatus: z.enum(fileProcessingStatuses),
  associatedProject: z.string().min(1).nullable()
})

export const filesManifestSchema = z.object({
  format: z.literal('research-studio-file-manifest'),
  version: z.literal(1),
  updatedAt: z.iso.datetime(),
  files: z.array(fileMetadataSchema)
})

export const jobRecordSchema = z.object({
  id: z.string().min(1),
  sourceFileId: z.string().min(1),
  sourcePath: z.string().min(1),
  jobType: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  status: z.enum(jobStatuses),
  outputLocation: z.string().min(1).nullable(),
  error: z
    .object({
      message: z.string().min(1),
      at: z.iso.datetime()
    })
    .nullable()
})

export const jobsManifestSchema = z.object({
  format: z.literal('research-studio-job-manifest'),
  version: z.literal(1),
  updatedAt: z.iso.datetime(),
  jobs: z.array(jobRecordSchema)
})

export type FileMetadata = z.infer<typeof fileMetadataSchema>
export type FilesManifest = z.infer<typeof filesManifestSchema>
export type JobRecord = z.infer<typeof jobRecordSchema>
export type JobsManifest = z.infer<typeof jobsManifestSchema>

export function emptyFilesManifest(now = new Date()): FilesManifest {
  return {
    format: 'research-studio-file-manifest',
    version: 1,
    updatedAt: now.toISOString(),
    files: []
  }
}

export function emptyJobsManifest(now = new Date()): JobsManifest {
  return {
    format: 'research-studio-job-manifest',
    version: 1,
    updatedAt: now.toISOString(),
    jobs: []
  }
}

export function readFilesManifest(path: string, now = new Date()): FilesManifest {
  if (!existsSync(path)) return emptyFilesManifest(now)
  return filesManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}

export function readJobsManifest(path: string, now = new Date()): JobsManifest {
  if (!existsSync(path)) return emptyJobsManifest(now)
  return jobsManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}

export function writeFilesManifest(path: string, manifest: FilesManifest): void {
  filesManifestSchema.parse(manifest)
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

export function writeJobsManifest(path: string, manifest: JobsManifest): void {
  jobsManifestSchema.parse(manifest)
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

export function upsertFileMetadata(
  manifest: FilesManifest,
  metadata: FileMetadata,
  now = new Date()
): { entry: FileMetadata; created: boolean } {
  const existing = manifest.files.find((file) => file.sourcePath === metadata.sourcePath)
  manifest.updatedAt = now.toISOString()
  if (!existing) {
    manifest.files.push(metadata)
    return { entry: metadata, created: true }
  }
  const updated: FileMetadata = {
    ...existing,
    filename: metadata.filename,
    extension: metadata.extension,
    byteSize: metadata.byteSize,
    lastSeenAt: metadata.lastSeenAt,
    modifiedAt: metadata.modifiedAt,
    sha256: metadata.sha256,
    processingStatus:
      existing.processingStatus === 'discovered'
        ? metadata.processingStatus
        : existing.processingStatus,
    associatedProject: existing.associatedProject ?? metadata.associatedProject
  }
  Object.assign(existing, updated)
  return { entry: existing, created: false }
}

export function enqueueJob(
  manifest: JobsManifest,
  job: JobRecord,
  now = new Date()
): { job: JobRecord; created: boolean } {
  const existing = manifest.jobs.find(
    (item) => item.sourceFileId === job.sourceFileId && item.jobType === job.jobType
  )
  manifest.updatedAt = now.toISOString()
  if (existing) return { job: existing, created: false }
  manifest.jobs.push(job)
  return { job, created: true }
}

const allowedTransitions: Record<JobStatus, JobStatus[]> = {
  queued: ['working', 'failed'],
  working: ['complete', 'failed'],
  complete: [],
  failed: ['queued']
}

export function transitionJob(
  manifest: JobsManifest,
  jobId: string,
  status: JobStatus,
  options: { now?: Date; outputLocation?: string | null; errorMessage?: string | null } = {}
): JobRecord {
  const job = manifest.jobs.find((item) => item.id === jobId)
  if (!job) throw new Error(`Job not found: ${jobId}`)
  if (job.status === status) return job
  if (!allowedTransitions[job.status].includes(status)) {
    throw new Error(`Cannot transition job ${jobId} from ${job.status} to ${status}.`)
  }
  const now = options.now ?? new Date()
  job.status = status
  job.updatedAt = now.toISOString()
  job.outputLocation = options.outputLocation ?? job.outputLocation
  job.error = options.errorMessage ? { message: options.errorMessage, at: now.toISOString() } : null
  manifest.updatedAt = now.toISOString()
  return job
}
