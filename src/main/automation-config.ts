import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { z } from 'zod'

export const DATA_ROOT_ENV = 'RESEARCH_STUDIO_DATA_ROOT'
export const CONFIG_PATH_ENV = 'RESEARCH_STUDIO_WORKER_CONFIG'
export const DRY_RUN_ENV = 'RESEARCH_STUDIO_WORKER_DRY_RUN'

const workerConfigFileSchema = z
  .object({
    sharedDataRoot: z.string().trim().min(1).optional(),
    dryRun: z.boolean().optional()
  })
  .strict()

export interface WorkerConfig {
  sharedDataRoot: string
  dryRun: boolean
}

export interface LoadWorkerConfigOptions {
  env?: NodeJS.ProcessEnv
  configPath?: string
  overrides?: Partial<WorkerConfig>
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  throw new Error(`${DRY_RUN_ENV} must be a boolean value.`)
}

function readConfigFile(path: string): Partial<WorkerConfig> {
  if (!existsSync(path)) throw new Error(`Worker config file was not found: ${path}`)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error('Worker config file must be valid JSON.')
  }
  return workerConfigFileSchema.parse(parsed)
}

export function loadWorkerConfig(options: LoadWorkerConfigOptions = {}): WorkerConfig {
  const env = options.env ?? process.env
  const configPath = options.configPath ?? env[CONFIG_PATH_ENV]
  const fileConfig = configPath ? readConfigFile(resolve(configPath)) : {}
  const sharedDataRoot =
    options.overrides?.sharedDataRoot ?? env[DATA_ROOT_ENV] ?? fileConfig.sharedDataRoot
  if (!sharedDataRoot) {
    throw new Error(
      `Set ${DATA_ROOT_ENV} or provide a JSON config file with sharedDataRoot before running the worker.`
    )
  }

  return {
    sharedDataRoot: resolve(sharedDataRoot),
    dryRun: options.overrides?.dryRun ?? parseBoolean(env[DRY_RUN_ENV]) ?? fileConfig.dryRun ?? true
  }
}
