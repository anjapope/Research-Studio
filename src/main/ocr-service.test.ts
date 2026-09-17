import { describe, expect, it } from 'vitest'
import { recognizeEnglish } from './ocr-service'

describe('local OCR', () => {
  it('loads the bundled OCR engine and English language data without a network service', async () => {
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
      'base64'
    )
    const result = await recognizeEnglish(onePixelPng)
    expect(result).toMatchObject({ language: 'eng' })
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(typeof result.text).toBe('string')
  }, 30_000)
})
