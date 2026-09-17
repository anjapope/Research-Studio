import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ path: '', encryption: true }))
vi.mock('electron', () => ({
  app: { getPath: () => state.path },
  safeStorage: {
    isEncryptionAvailable: () => state.encryption,
    encryptString: (text: string) => Buffer.from(text.split('').reverse().join('')),
    decryptString: (bytes: Buffer) => bytes.toString().split('').reverse().join('')
  }
}))
import { TeachingSettings } from './teaching-settings'

afterEach(() => {
  if (state.path) rmSync(state.path, { recursive: true, force: true })
  state.encryption = true
})
describe('teaching AI settings', () => {
  it('stores encrypted key material, exposes only status, and supports replacement/removal', () => {
    state.path = mkdtempSync(join(tmpdir(), 'teaching-settings-'))
    const settings = new TeachingSettings()
    expect(settings.get().hasKey).toBe(false)
    expect(settings.save({ model: 'gpt-4.1', apiKey: 'secret-test-key' })).toEqual({
      model: 'gpt-4.1',
      hasKey: true,
      canStoreKey: true
    })
    expect(readFileSync(join(state.path, 'teaching-ai.json'), 'utf8')).not.toContain(
      'secret-test-key'
    )
    settings.save({ model: 'another-model' })
    expect(new TeachingSettings().credentials()).toEqual({
      model: 'another-model',
      apiKey: 'secret-test-key'
    })
    settings.save({ model: 'another-model', apiKey: 'replacement' })
    expect(settings.credentials().apiKey).toBe('replacement')
    settings.save({ model: 'another-model', removeKey: true })
    expect(settings.get().hasKey).toBe(false)
    expect(() => settings.credentials()).toThrow('Add an OpenAI API key')
  })
  it('refuses to persist keys when secure storage is unavailable', () => {
    state.path = mkdtempSync(join(tmpdir(), 'teaching-settings-'))
    state.encryption = false
    expect(() => new TeachingSettings().save({ model: 'gpt-4.1', apiKey: 'test-key' })).toThrow(
      'Secure key storage'
    )
  })
})
