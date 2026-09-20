import {
  existsSync,
  mkdirSync,
  readdirSync,
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

export function sharedPath(root: string, ...segments: string[]): string {
  const normalizedRoot = resolve(root)
  const candidate = resolve(normalizedRoot, ...segments)
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error('Shared-folder path escaped the configured Research Studio data root.')
  }
  return candidate
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
