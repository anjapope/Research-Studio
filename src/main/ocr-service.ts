import eng from '@tesseract.js-data/eng'
import { createWorker } from 'tesseract.js'
import type { OcrResult } from '../shared/domain'

export async function recognizeEnglish(image: Uint8Array): Promise<OcrResult> {
  if (!image.byteLength) throw new Error('The PDF page image is empty.')
  if (image.byteLength > 25 * 1024 * 1024)
    throw new Error('The PDF page image is too large for OCR.')
  const worker = await createWorker('eng', 1, {
    langPath: eng.langPath,
    gzip: eng.gzip,
    cacheMethod: 'none'
  })
  try {
    const result = await worker.recognize(Buffer.from(image))
    return {
      text: result.data.text
        .replace(/\s+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
      confidence: Math.max(0, Math.min(100, result.data.confidence)),
      language: 'eng'
    }
  } finally {
    await worker.terminate()
  }
}
