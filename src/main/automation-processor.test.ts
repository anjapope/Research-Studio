import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { extname, join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  sharedFolderPath,
  extractOutputPath,
  manifestPath,
  processingJobPath,
  resolveSharedManifestPath
} from './automation-fs'
import { processQueuedJobs } from './automation-processor'
import { scanInbox } from './automation-worker'
import type { FilesManifest, JobsManifest } from './automation-manifest'

const paths: string[] = []

function temporary(): string {
  const path = mkdtempSync(join(tmpdir(), 'research-studio-stage-c-'))
  paths.push(path)
  return path
}

function simplePdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  ]
  let output = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output))
    output += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(output)
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(output)
}

function prepare(root: string, filename: string, contents: string | Buffer): void {
  scanInbox({ sharedDataRoot: root, dryRun: false })
  writeFileSync(join(sharedFolderPath(root, 'inbox'), filename), contents)
  scanInbox({ sharedDataRoot: root, dryRun: false })
}

function readManifest(root: string, name: 'files'): FilesManifest
function readManifest(root: string, name: 'jobs'): JobsManifest
function readManifest(root: string, name: 'files' | 'jobs'): FilesManifest | JobsManifest {
  return JSON.parse(readFileSync(manifestPath(root, `${name}.json`), 'utf8'))
}

afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('document ingestion worker', () => {
  it.each([
    ['notes.txt', 'A plain text note.'],
    ['notes.md', '# Markdown note\n\nA research passage.']
  ])('preserves and extracts %s', async (filename, contents) => {
    const root = temporary()
    prepare(root, filename, contents)

    const result = await processQueuedJobs({ sharedDataRoot: root, dryRun: false })
    const files = readManifest(root, 'files')
    const jobs = readManifest(root, 'jobs')
    const file = files.files.find((item) => item.filename === filename)!
    const job = jobs.jobs.find((item) => item.sourceFileId === file.id)!
    const preservedSourcePath = resolveSharedManifestPath(root, file.preservedSourcePath!).path
    const extractedTextPath = resolveSharedManifestPath(root, file.extractedTextPath!).path
    const extractionRecordPath = resolveSharedManifestPath(root, file.extractionRecordPath!).path
    const extraction = JSON.parse(readFileSync(extractionRecordPath, 'utf8'))

    expect(result).toMatchObject({ consideredJobs: 1, completedJobs: 1, failedJobs: 0 })
    expect(job).toMatchObject({
      status: 'complete',
      processor: 'research-studio-document-processor/1',
      queuedAt: expect.any(String),
      workingAt: expect.any(String),
      completedAt: expect.any(String)
    })
    expect(file).toMatchObject({
      processingStatus: 'complete',
      extractionStatus: 'extracted',
      processingJobId: job.id,
      preservedSourcePath: expect.any(String),
      extractedTextPath: expect.any(String),
      extractionRecordPath: expect.any(String)
    })
    expect(readFileSync(preservedSourcePath, 'utf8')).toBe(contents)
    expect(readFileSync(extractedTextPath, 'utf8')).toContain(contents)
    expect(extraction).toMatchObject({
      fileId: file.id,
      jobId: job.id,
      originalFilename: filename,
      originalSourcePath: file.producerSourcePath,
      sourcePath: file.sourcePath,
      preservedSourcePath: file.preservedSourcePath,
      sha256: file.sha256,
      extractionStatus: 'extracted',
      outputLocation: file.extractionRecordPath,
      textOutputLocation: file.extractedTextPath
    })
    expect(existsSync(processingJobPath(root, 'queued', job.id))).toBe(false)
    expect(existsSync(processingJobPath(root, 'working', job.id))).toBe(false)
    expect(existsSync(processingJobPath(root, 'complete', job.id))).toBe(true)
  })

  it('extracts embedded PDF text and records page metadata', async () => {
    const root = temporary()
    prepare(root, 'article.pdf', simplePdf('Embedded PDF research text'))

    await processQueuedJobs({ sharedDataRoot: root, dryRun: false })

    const file = readManifest(root, 'files').files[0]
    const extraction = JSON.parse(
      readFileSync(resolveSharedManifestPath(root, file.extractionRecordPath!).path, 'utf8')
    )
    expect(extraction).toMatchObject({
      extractionStatus: 'extracted',
      pageCount: 1,
      characterCount: expect.any(Number),
      normalizedText: expect.stringContaining('Embedded PDF research text')
    })
    expect(
      readFileSync(resolveSharedManifestPath(root, file.extractedTextPath!).path, 'utf8')
    ).toContain('--- Page 1 ---')
  })

  it('completes scanned PDFs with an explicit needs-ocr status', async () => {
    const root = temporary()
    prepare(root, 'scanned.pdf', simplePdf(''))

    const result = await processQueuedJobs({ sharedDataRoot: root, dryRun: false })
    const file = readManifest(root, 'files').files[0]
    const job = readManifest(root, 'jobs').jobs[0]

    expect(result.completedJobs).toBe(1)
    expect(job.status).toBe('complete')
    expect(file.extractionStatus).toBe('needs-ocr')
    expect(file.warnings ?? []).toContain('No embedded PDF text was found; OCR is required.')
  })

  it('is idempotent and does not create duplicate completed outputs', async () => {
    const root = temporary()
    prepare(root, 'repeat.txt', 'Repeatable source')

    const first = await processQueuedJobs({ sharedDataRoot: root, dryRun: false })
    const second = await processQueuedJobs({ sharedDataRoot: root, dryRun: false })
    const jobs = readManifest(root, 'jobs')

    expect(first.completedJobs).toBe(1)
    expect(second.consideredJobs).toBe(0)
    expect(jobs.jobs).toHaveLength(1)
    expect(jobs.jobs[0].status).toBe('complete')
    expect(jobs.jobs[0].outputLocation).toBe(`Outputs/Extracts/${jobs.jobs[0].sourceFileId}.json`)
  })

  it('fails unsupported files while preserving the source and continuing the queue', async () => {
    const root = temporary()
    prepare(root, 'unsupported.bin', Buffer.from('binary'))
    writeFileSync(join(sharedFolderPath(root, 'inbox'), 'valid.txt'), 'Valid document')
    scanInbox({ sharedDataRoot: root, dryRun: false })

    const result = await processQueuedJobs({ sharedDataRoot: root, dryRun: false })
    const files = readManifest(root, 'files').files
    const jobs = readManifest(root, 'jobs').jobs
    const unsupported = files.find((item) => extname(item.filename) === '.bin')!
    const valid = files.find((item) => item.filename === 'valid.txt')!

    expect(result).toMatchObject({ consideredJobs: 2, completedJobs: 1, failedJobs: 1 })
    expect(unsupported).toMatchObject({
      processingStatus: 'failed',
      extractionStatus: 'unsupported-file-type'
    })
    expect(jobs.find((item) => item.sourceFileId === unsupported.id)!.error!.message).toContain(
      'unsupported-file-type'
    )
    expect(existsSync(resolveSharedManifestPath(root, unsupported.preservedSourcePath!).path)).toBe(
      true
    )
    expect(valid.processingStatus).toBe('complete')
  })

  it('records failed extraction and leaves the original Inbox file untouched', async () => {
    const root = temporary()
    prepare(root, 'broken.pdf', Buffer.from('%PDF-1.4 malformed'))
    const source = join(sharedFolderPath(root, 'inbox'), 'broken.pdf')
    const before = readFileSync(source)

    const result = await processQueuedJobs({ sharedDataRoot: root, dryRun: false })
    const job = readManifest(root, 'jobs').jobs[0]

    expect(result.failedJobs).toBe(1)
    expect(job.status).toBe('failed')
    expect(job.error?.message).toBeTruthy()
    expect(readFileSync(source)).toEqual(before)
    expect(existsSync(processingJobPath(root, 'failed', job.id))).toBe(true)
  })

  it('reports changed content at the same path as a new checksum-aware job', async () => {
    const root = temporary()
    prepare(root, 'changing.txt', 'Version one')
    const firstFile = readManifest(root, 'files').files[0]
    writeFileSync(join(sharedFolderPath(root, 'inbox'), 'changing.txt'), 'Version two')

    const scan = scanInbox({ sharedDataRoot: root, dryRun: false })
    const files = readManifest(root, 'files').files
    const jobs = readManifest(root, 'jobs').jobs

    expect(scan.newFiles).toBe(1)
    expect(files).toHaveLength(2)
    expect(new Set(files.map((file) => file.id)).size).toBe(2)
    expect(jobs).toHaveLength(2)
    expect(jobs.some((job) => job.sourceFileId === firstFile.id)).toBe(true)
  })

  it('supports processing dry-run without moving jobs or creating outputs', async () => {
    const root = temporary()
    prepare(root, 'dry-run.txt', 'Do not write')
    const job = readManifest(root, 'jobs').jobs[0]

    const result = await processQueuedJobs({ sharedDataRoot: root, dryRun: true })

    expect(result).toMatchObject({ dryRun: true, consideredJobs: 1, completedJobs: 1 })
    expect(existsSync(processingJobPath(root, 'queued', job.id))).toBe(true)
    expect(existsSync(processingJobPath(root, 'complete', job.id))).toBe(false)
    expect(existsSync(extractOutputPath(root, job.sourceFileId, 'json'))).toBe(false)
  })

  it('writes correlated JSONL processing events without document contents', async () => {
    const root = temporary()
    prepare(root, 'logged.txt', 'Do not log this document body')

    await processQueuedJobs({ sharedDataRoot: root, dryRun: false })

    const logPath = join(
      sharedFolderPath(root, 'systemLogs'),
      `${new Date().toISOString().slice(0, 10)}.jsonl`
    )
    const log = readFileSync(logPath, 'utf8')
    expect(log).toContain('job-claimed')
    expect(log).toContain('source-preserved')
    expect(log).toContain('extraction-started')
    expect(log).toContain('extraction-completed')
    expect(log).toContain('job-completed')
    expect(log).not.toContain('Do not log this document body')
  })
})
