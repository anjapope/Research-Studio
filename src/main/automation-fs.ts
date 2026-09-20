import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { basename, dirname, join, resolve, sep } from 'path'

export const sharedFolderLayout = {
  inbox: ['Inbox'],
  sourcePdfs: ['Sources', 'PDFs'],
  sourceData: ['Sources', 'Data'],
  sourceMedia: ['Sources', 'Media'],
  projects: ['Projects'],
  processingQueued: ['Processing', 'Queued'],
  processingWorking: ['Processing', 'Working'],
  processingComplete: ['Processing', 'Complete'],
  processingFailed: ['Processing', 'Failed'],
  outputReports: ['Outputs', 'Reports'],
  outputExtracts: ['Outputs', 'Extracts'],
  outputExports: ['Outputs', 'Exports'],
  systemManifests: ['System', 'manifests'],
  systemLogs: ['System', 'logs'],
  systemConfig: ['System', 'config']
} as const

export type SharedFolderKey = keyof typeof sharedFolderLayout

const sharedLayoutPrefixes = Object.values(sharedFolderLayout).map((segments) => [...segments])

export function sharedPath(root: string, ...segments: string[]): string {
  const normalizedRoot = resolve(root)
  const candidate = resolve(normalizedRoot, ...segments)
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error('Shared-folder path escaped the configured Research Studio data root.')
  }
  return candidate
}

function portableSegments(reference: string): string[] {
  if (
    !reference ||
    reference.includes('\\') ||
    reference.startsWith('/') ||
    /^[a-z]:/i.test(reference)
  ) {
    throw new Error('Shared manifest paths must be portable root-relative references.')
  }
  const segments = reference.split('/')
  if (
    segments.some(
      (segment) => !segment || segment === '.' || segment === '..' || segment.includes(':')
    )
  ) {
    throw new Error('Shared manifest path traversal is not allowed.')
  }
  return segments
}

function legacyAbsoluteReference(reference: string): string | null {
  const isWindowsAbsolute = /^[a-z]:[\\/]/i.test(reference) || reference.startsWith('\\\\')
  if (!reference.startsWith('/') && !isWindowsAbsolute) return null
  const segments = reference.replace(/\\/g, '/').split('/').filter(Boolean)
  const matches = sharedLayoutPrefixes.flatMap((prefix) =>
    segments.flatMap((segment, index) => {
      if (
        segment !== prefix[0] ||
        index + prefix.length >= segments.length ||
        !prefix.every((part, offset) => segments[index + offset] === part)
      ) {
        return []
      }
      return [segments.slice(index).join('/')]
    })
  )
  if (matches.length !== 1) {
    throw new Error(
      'The absolute shared manifest path does not contain one recognized shared-folder reference.'
    )
  }
  portableSegments(matches[0])
  return matches[0]
}

function assertNoSymlinkEscape(root: string, candidate: string): void {
  if (!existsSync(candidate)) return
  const actualRoot = realpathSync(resolve(root))
  const actualCandidate = realpathSync(candidate)
  if (actualCandidate !== actualRoot && !actualCandidate.startsWith(`${actualRoot}${sep}`)) {
    throw new Error('Shared manifest path resolves through a symlink outside the configured root.')
  }
}

export interface SharedManifestPath {
  path: string
  reference: string
  legacyAbsolute: boolean
}

export function sharedPathReference(root: string, path: string): string {
  const normalizedRoot = resolve(root)
  const candidate = resolve(path)
  if (candidate === normalizedRoot || !candidate.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error('Shared path is outside the configured Research Studio data root.')
  }
  const reference = candidate
    .slice(normalizedRoot.length + 1)
    .split(sep)
    .join('/')
  portableSegments(reference)
  return reference
}

export function resolveSharedManifestPath(root: string, reference: string): SharedManifestPath {
  const legacyReference = legacyAbsoluteReference(reference)
  const portableReference = legacyReference ?? reference
  const candidate = sharedPath(root, ...portableSegments(portableReference))
  assertNoSymlinkEscape(root, candidate)
  return {
    path: candidate,
    reference: portableReference,
    legacyAbsolute: legacyReference !== null
  }
}

export function existingSharedManifestPath(root: string, reference: string): SharedManifestPath {
  const resolved = resolveSharedManifestPath(root, reference)
  if (!existsSync(resolved.path) || !statSync(resolved.path).isFile()) {
    throw new Error('The shared manifest path does not reference an available file.')
  }
  return resolved
}

export function sharedFolderPath(root: string, key: SharedFolderKey): string {
  return sharedPath(root, ...sharedFolderLayout[key])
}

export function ensureSharedFolderStructure(root: string, dryRun: boolean): string[] {
  const created: string[] = []
  for (const key of Object.keys(sharedFolderLayout) as SharedFolderKey[]) {
    const path = sharedFolderPath(root, key)
    if (!existsSync(path)) {
      created.push(path)
      if (!dryRun) mkdirSync(path, { recursive: true })
    }
  }
  return created
}

export function listInboxFiles(root: string): string[] {
  const inbox = sharedFolderPath(root, 'inbox')
  if (!existsSync(inbox)) return []
  return readdirSync(inbox)
    .map((name) => join(inbox, name))
    .filter((path) => statSync(path).isFile())
    .sort((left, right) => left.localeCompare(right))
}

export function manifestPath(root: string, name: string): string {
  if (!/^[a-z0-9-]+\.json$/i.test(name)) throw new Error('Manifest names must be JSON filenames.')
  return sharedPath(root, ...sharedFolderLayout.systemManifests, name)
}

export function processingJobPath(root: string, status: string, jobId: string): string {
  if (!/^[a-z0-9-]+$/i.test(jobId)) throw new Error('Job IDs must be path-safe.')
  if (!['queued', 'working', 'complete', 'failed'].includes(status)) {
    throw new Error('Unsupported processing status.')
  }
  const folderKey = `processing${status[0].toUpperCase()}${status.slice(1)}` as SharedFolderKey
  return sharedPath(root, ...sharedFolderLayout[folderKey], `${jobId}.json`)
}

export function workerLogPath(root: string, at: Date): string {
  return sharedPath(
    root,
    ...sharedFolderLayout.systemLogs,
    `${at.toISOString().slice(0, 10)}.jsonl`
  )
}

export function extractOutputPath(root: string, fileId: string, extension: 'json' | 'txt'): string {
  if (!/^[a-z0-9-]+$/i.test(fileId)) throw new Error('File IDs must be path-safe.')
  return sharedPath(root, ...sharedFolderLayout.outputExtracts, `${fileId}.${extension}`)
}

export function preservedSourcePath(
  root: string,
  sourceType: 'pdf' | 'data',
  filename: string
): string {
  const safeName = [...basename(filename)]
    .map((character) =>
      '<>:"/\\|?*'.includes(character) || character.charCodeAt(0) < 32 ? '-' : character
    )
    .join('')
    .trim()
  if (!safeName) throw new Error('A preserved source must have a filename.')
  const key = sourceType === 'pdf' ? 'sourcePdfs' : 'sourceData'
  return sharedPath(root, ...sharedFolderLayout[key], safeName)
}

export function processingJobDirectory(root: string, status: string): string {
  if (!['queued', 'working', 'complete', 'failed'].includes(status)) {
    throw new Error('Unsupported processing status.')
  }
  const folderKey = `processing${status[0].toUpperCase()}${status.slice(1)}` as SharedFolderKey
  return sharedPath(root, ...sharedFolderLayout[folderKey])
}

export function listProcessingJobPaths(root: string, status: string): string[] {
  const directory = processingJobDirectory(root, status)
  if (!existsSync(directory)) return []
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => join(directory, name))
    .filter((path) => statSync(path).isFile())
    .sort((left, right) => left.localeCompare(right))
}

export function writeTextAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(temporary, contents, 'utf8')
    renameSync(temporary, path)
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary)
    throw error
  }
}
