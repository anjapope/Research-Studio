import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import type { TeachingAiSettings } from '../shared/teaching'

const modelSchema = z
  .string()
  .trim()
  .min(1)
  .max(150)
  .regex(/^[a-zA-Z0-9._:-]+$/)
const configSchema = z.object({ model: modelSchema, encryptedKey: z.string().optional() })
const settingsSchema = z.object({
  model: modelSchema,
  apiKey: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .regex(/^[\x21-\x7E]+$/)
    .optional(),
  removeKey: z.boolean().optional()
})

export class TeachingSettings {
  private readonly path = join(app.getPath('userData'), 'teaching-ai.json')
  private read(): z.infer<typeof configSchema> {
    if (!existsSync(this.path)) return { model: 'gpt-4.1' }
    try {
      return configSchema.parse(JSON.parse(readFileSync(this.path, 'utf8')))
    } catch {
      throw new Error('AI settings could not be read. Save your model and API key again.')
    }
  }
  get(): TeachingAiSettings {
    const config = this.read()
    return {
      model: config.model,
      hasKey: Boolean(config.encryptedKey),
      canStoreKey: safeStorage.isEncryptionAvailable()
    }
  }
  save(input: unknown): TeachingAiSettings {
    // Never return validation details that could include credential input.
    const parsed = settingsSchema.safeParse(input)
    if (!parsed.success) throw new Error('Enter a valid model name and API key.')
    const draft = parsed.data
    let config: z.infer<typeof configSchema>
    try {
      config = this.read()
    } catch {
      config = { model: draft.model }
    }
    if (draft.removeKey) delete config.encryptedKey
    else if (draft.apiKey) {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error('Secure key storage is unavailable on this computer.')
      config.encryptedKey = safeStorage.encryptString(draft.apiKey).toString('base64')
    }
    config.model = draft.model
    writeFileSync(`${this.path}.tmp`, JSON.stringify(config), { encoding: 'utf8', mode: 0o600 })
    renameSync(`${this.path}.tmp`, this.path)
    return this.get()
  }
  credentials(): { model: string; apiKey: string } {
    const config = this.read()
    if (!config.encryptedKey) throw new Error('Add an OpenAI API key in AI settings first.')
    try {
      if (!safeStorage.isEncryptionAvailable()) throw new Error()
      return {
        model: config.model,
        apiKey: safeStorage.decryptString(Buffer.from(config.encryptedKey, 'base64'))
      }
    } catch {
      throw new Error('The saved API key could not be decrypted. Enter it again in AI settings.')
    }
  }
}
