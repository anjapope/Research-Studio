import { createHash } from 'crypto'
import {
  copyFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { basename, dirname, join, resolve, sep } from 'path'
import { z } from 'zod'
import type {
  Interview,
  IntegrityItem,
  IntegrityReport,
  QualitativeCode,
  SynthesisMemo,
  WorkspaceInfo,
  WorkspacePackageSummary
} from '../shared/domain'
import { WorkspaceDatabase } from './database'
import { migrations } from './migrations'

const packageFileSchema = z.object({
  relativePath: z.string().min(1).max(1_000),
  byteSize: z.number().int().min(0),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
})

const packageManifestSchema = z.object({
  format: z.literal('research-studio-workspace'),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  workspace: z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(500),
    createdAt: z.iso.datetime(),
    schemaVersion: z.number().int().min(1)
  }),
  files: z.array(packageFileSchema).min(1).max(100_000)
})

export type WorkspacePackageManifest = z.infer<typeof packageManifestSchema>

function checksum(path: string): string {
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

function safePackagePath(root: string, relativePath: string): string {
  if (
    relativePath.includes('\0') ||
    relativePath.startsWith('/') ||
    relativePath.startsWith('\\') ||
    /^[a-zA-Z]:/.test(relativePath)
  ) {
    throw new Error('The workspace package contains an unsafe file path.')
  }
  const candidate = resolve(root, relativePath)
  const normalizedRoot = resolve(root)
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error('The workspace package contains an unsafe file path.')
  }
  return candidate
}

function packageName(name: string): string {
  const safe = [...name]
    .map((character) =>
      '<>:"/\\|?*'.includes(character) || character.charCodeAt(0) < 32 ? '-' : character
    )
    .join('')
    .trim()
    .slice(0, 80)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${safe || 'workspace'}-${stamp}.research-studio-backup`
}

export function createWorkspacePackage(
  database: WorkspaceDatabase,
  destinationRoot: string
): WorkspacePackageSummary {
  const info = database.info()
  const packagePath = join(resolve(destinationRoot), packageName(info.name))
  if (existsSync(packagePath)) throw new Error('A backup with this name already exists.')
  mkdirSync(packagePath, { recursive: false })
  try {
    const snapshotPath = join(packagePath, 'workspace.sqlite3')
    database.createSnapshot(snapshotPath)
    const files: WorkspacePackageManifest['files'] = [
      {
        relativePath: 'workspace.sqlite3',
        byteSize: statSync(snapshotPath).size,
        sha256: checksum(snapshotPath)
      }
    ]
    for (const item of database.managedFileInventory()) {
      const source = database.resolveStoredFile(item.kind, item.relativePath)
      if (!existsSync(source)) {
        throw new Error(`Cannot back up missing managed file: ${item.name}`)
      }
      const sourceSize = statSync(source).size
      const sourceSha256 = checksum(source)
      if (sourceSize !== item.byteSize || sourceSha256 !== item.sha256) {
        throw new Error(`Cannot back up modified managed file: ${item.name}`)
      }
      const targetRelative = item.relativePath.replace(/\\/g, '/')
      const target = safePackagePath(packagePath, targetRelative)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(source, target)
      files.push({
        relativePath: targetRelative,
        byteSize: statSync(target).size,
        sha256: sourceSha256
      })
    }
    const manifest: WorkspacePackageManifest = {
      format: 'research-studio-workspace',
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace: {
        id: info.id,
        name: info.name,
        createdAt: info.createdAt,
        schemaVersion: database.schemaVersion()
      },
      files
    }
    writeFileSync(
      join(packagePath, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    )
    readWorkspacePackage(packagePath)
    return {
      path: packagePath,
      workspaceName: info.name,
      exportedAt: manifest.exportedAt,
      fileCount: files.length,
      byteSize: files.reduce((total, file) => total + file.byteSize, 0)
    }
  } catch (error) {
    rmSync(packagePath, { recursive: true, force: true })
    throw error
  }
}

export function readWorkspacePackage(packagePath: string): WorkspacePackageManifest {
  const root = resolve(packagePath)
  const manifestPath = join(root, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error('This folder is not a Research Studio backup.')
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    throw new Error('The workspace backup manifest is not valid JSON.')
  }
  const manifest = packageManifestSchema.parse(parsed)
  const currentSchemaVersion = migrations[migrations.length - 1]?.version ?? 0
  if (manifest.workspace.schemaVersion > currentSchemaVersion) {
    throw new Error('This backup was created by a newer version of Research Studio.')
  }
  const paths = new Set<string>()
  for (const file of manifest.files) {
    const normalized = file.relativePath.replace(/\\/g, '/')
    if (
      normalized !== 'workspace.sqlite3' &&
      !normalized.startsWith('files/') &&
      !normalized.startsWith('interview-media/') &&
      !normalized.startsWith('project-files/')
    ) {
      throw new Error('The workspace package contains an unsupported file path.')
    }
    if (paths.has(normalized)) throw new Error('The workspace package lists a file more than once.')
    paths.add(normalized)
    const path = safePackagePath(root, normalized)
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`The workspace package is missing ${normalized}.`)
    }
    if (statSync(path).size !== file.byteSize || checksum(path) !== file.sha256) {
      throw new Error(`The workspace package failed its integrity check for ${normalized}.`)
    }
  }
  if (!paths.has('workspace.sqlite3')) {
    throw new Error('The workspace package does not contain a database snapshot.')
  }
  return manifest
}

export function restoreWorkspacePackage(packagePath: string, destination: string): WorkspaceInfo {
  const root = resolve(packagePath)
  const target = resolve(destination)
  if (root === target || root.startsWith(`${target}${sep}`) || target.startsWith(`${root}${sep}`)) {
    throw new Error('Choose a restore location outside the backup folder.')
  }
  const storage = join(target, '.research-studio')
  if (existsSync(storage) || (existsSync(target) && readdirSync(target).length > 0)) {
    throw new Error('Restore into an empty folder.')
  }
  const manifest = readWorkspacePackage(root)
  mkdirSync(storage, { recursive: true })
  try {
    for (const file of manifest.files) {
      const normalized = file.relativePath.replace(/\\/g, '/')
      const source = safePackagePath(root, normalized)
      const output = safePackagePath(storage, normalized)
      mkdirSync(dirname(output), { recursive: true })
      copyFileSync(source, output)
    }
    let restored: WorkspaceDatabase | null = null
    try {
      restored = new WorkspaceDatabase(target)
      const report = checkWorkspaceIntegrity(restored)
      if (report.databaseStatus !== 'ok' || report.missingCount || report.modifiedCount) {
        throw new Error('The restored workspace did not pass its integrity check.')
      }
      return restored.info()
    } finally {
      restored?.close()
    }
  } catch (error) {
    rmSync(storage, { recursive: true, force: true })
    throw error
  }
}

export function checkWorkspaceIntegrity(database: WorkspaceDatabase): IntegrityReport {
  const items: IntegrityItem[] = database.managedFileInventory().map((file) => {
    const path = database.resolveStoredFile(file.kind, file.relativePath)
    if (!existsSync(path)) {
      return {
        kind: file.kind,
        name: file.name,
        relativePath: file.relativePath,
        status: 'missing',
        expectedSha256: file.sha256,
        actualSha256: null
      }
    }
    const actual = checksum(path)
    return {
      kind: file.kind,
      name: file.name,
      relativePath: file.relativePath,
      status: actual === file.sha256 ? 'ok' : 'modified',
      expectedSha256: file.sha256,
      actualSha256: actual
    }
  })
  const databaseStatus = database.integrityCheck() ? 'ok' : 'error'
  items.unshift({
    kind: 'database',
    name: 'workspace.sqlite3',
    relativePath: 'workspace.sqlite3',
    status: databaseStatus === 'ok' ? 'ok' : 'modified',
    expectedSha256: null,
    actualSha256: null
  })
  return {
    checkedAt: new Date().toISOString(),
    databaseStatus,
    items,
    okCount: items.filter((item) => item.status === 'ok').length,
    missingCount: items.filter((item) => item.status === 'missing').length,
    modifiedCount: items.filter((item) => item.status === 'modified').length
  }
}

export function packageDisplayName(path: string): string {
  return basename(path).replace(/\.research-studio-backup$/, '')
}

function csvField(value: string | number | null): string {
  if (value === null) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function qualitativeCsv(
  interviews: Interview[],
  codes: QualitativeCode[],
  memos: SynthesisMemo[]
): string {
  const header = [
    'record_type',
    'record_id',
    'project_id',
    'interview_title',
    'participant',
    'speaker',
    'start_seconds',
    'end_seconds',
    'text',
    'codes',
    'status',
    'title',
    'linked_passage_ids',
    'updated_at'
  ]
  const rows: (string | number | null)[][] = []
  for (const interview of interviews) {
    rows.push([
      'interview',
      interview.id,
      interview.projectId,
      interview.title,
      interview.participantName,
      null,
      null,
      null,
      interview.consentNote,
      null,
      interview.status,
      interview.title,
      null,
      interview.updatedAt
    ])
    for (const segment of interview.segments) {
      rows.push([
        'transcript_segment',
        segment.id,
        interview.projectId,
        interview.title,
        interview.participantName,
        segment.speaker,
        segment.startSeconds,
        segment.endSeconds,
        segment.text,
        segment.codes.map((code) => code.name).join('; '),
        interview.status,
        null,
        null,
        segment.updatedAt
      ])
    }
  }
  for (const code of codes) {
    rows.push([
      'qualitative_code',
      code.id,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      code.name,
      null,
      code.name,
      null,
      null
    ])
  }
  for (const memo of memos) {
    rows.push([
      'synthesis_memo',
      memo.id,
      memo.projectId,
      null,
      null,
      null,
      null,
      null,
      memo.body,
      null,
      memo.status,
      memo.title,
      memo.passages.map((passage) => passage.segmentId).join('; '),
      memo.updatedAt
    ])
  }
  return `${[header, ...rows]
    .map((row) => row.map((value) => csvField(value)).join(','))
    .join('\r\n')}\r\n`
}
