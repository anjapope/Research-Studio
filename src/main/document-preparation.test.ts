import { describe, expect, it, vi } from 'vitest'
import type { DocumentPageText } from '../shared/domain'
import {
  preparationPages,
  prepareDocument,
  type PreparationIO,
  type PreparationProgress
} from '../shared/document-preparation'

function harness(): { saved: Map<number, DocumentPageText>; io: PreparationIO } {
  const saved = new Map<number, DocumentPageText>()
  const io: PreparationIO = {
    getSaved: vi.fn(async (page) => saved.get(page) ?? null),
    extract: vi.fn(async (page) => (page === 2 ? '' : `Text on page ${page}`)),
    recognize: vi.fn(async () => ({ text: 'Recognized passage', confidence: 87, language: 'eng' })),
    save: vi.fn(async (page, text, method, confidence) => {
      const record: DocumentPageText = {
        id: saved.get(page)?.id ?? `page-${page}`,
        sourceFileId: 'file-a',
        page,
        text,
        extractionMethod: method,
        confidence: confidence ?? null,
        language: method === 'ocr' ? 'eng' : null,
        fileSha256: 'checksum',
        extractedAt: 'now',
        updatedAt: 'now'
      }
      saved.set(page, record)
      return record
    })
  }
  return { saved, io }
}

describe('full-source preparation', () => {
  it('checks every page, preserves locators, reports coverage, and only OCRs on explicit request', async () => {
    const { saved, io } = harness()
    const updates: PreparationProgress[] = []
    const signal = new AbortController().signal
    const text = await prepareDocument(preparationPages(3, []), 'text', io, signal, (value) =>
      updates.push(value)
    )
    expect(text.pages.map((item) => item.status)).toEqual(['readable', 'needs-ocr', 'readable'])
    expect(text).toMatchObject({ status: 'complete', completed: 3, workTotal: 3 })
    expect(io.recognize).not.toHaveBeenCalled()
    expect(saved.get(3)).toMatchObject({ page: 3, sourceFileId: 'file-a', text: 'Text on page 3' })
    expect(updates[0].completed).toBe(0)
    const ocr = await prepareDocument(text.pages, 'ocr', io, signal, () => {})
    expect(io.recognize).toHaveBeenCalledExactlyOnceWith(2)
    expect(ocr.pages.every((item) => item.status === 'readable')).toBe(true)
    expect(saved.get(2)).toMatchObject({ extractionMethod: 'ocr', confidence: 87 })
    await prepareDocument(ocr.pages, 'text', io, signal, () => {})
    expect(io.extract).toHaveBeenCalledTimes(3)
    expect(saved.size).toBe(3)
  })

  it('continues past a page failure and retries only unreadable pages', async () => {
    const { io } = harness()
    vi.mocked(io.extract).mockRejectedValueOnce(new Error('Damaged page stream'))
    const signal = new AbortController().signal
    const first = await prepareDocument(preparationPages(3, []), 'text', io, signal, () => {})
    expect(first.pages[0]).toMatchObject({
      page: 1,
      status: 'failed',
      error: 'Damaged page stream'
    })
    expect(first.pages[2].status).toBe('readable')
    const retry = await prepareDocument(first.pages, 'text', io, signal, () => {})
    expect(retry.pages[0].status).toBe('readable')
    expect(io.extract).toHaveBeenCalledTimes(5)
  })

  it('offers OCR for a page whose embedded-text extraction failed', async () => {
    const { io } = harness()
    vi.mocked(io.extract).mockRejectedValueOnce(new Error('Unreadable stream'))
    const signal = new AbortController().signal
    const text = await prepareDocument(preparationPages(1, []), 'text', io, signal, () => {})
    const ocr = await prepareDocument(text.pages, 'ocr', io, signal, () => {})
    expect(text.pages[0].status).toBe('failed')
    expect(ocr.pages[0]).toMatchObject({ status: 'readable', method: 'ocr' })
    expect(io.recognize).toHaveBeenCalledWith(1)
  })

  it('cancels during extraction without saving that page and resumes from committed pages', async () => {
    const { io, saved } = harness()
    const controller = new AbortController()
    vi.mocked(io.extract).mockImplementation(async (page) => {
      if (page === 2) controller.abort()
      return `Text ${page}`
    })
    const result = await prepareDocument(
      preparationPages(3, []),
      'text',
      io,
      controller.signal,
      () => {}
    )
    expect(result.status).toBe('cancelled')
    expect([...saved.keys()]).toEqual([1])
    expect(io.extract).toHaveBeenCalledTimes(2)
    const resumed = await prepareDocument(
      result.pages,
      'text',
      io,
      new AbortController().signal,
      () => {}
    )
    expect(resumed.pages.every((item) => item.status === 'readable')).toBe(true)
    expect(saved.size).toBe(3)
  })

  it('does not save an OCR result after cancellation or start subsequent OCR pages', async () => {
    const { io } = harness()
    const controller = new AbortController()
    vi.mocked(io.recognize).mockImplementation(async () => {
      controller.abort()
      return { text: 'Late result', confidence: 90, language: 'eng' }
    })
    const pages = preparationPages(
      2,
      [1, 2].map((page) => ({ page, readable: false, extractionMethod: 'pdf-text' }))
    )
    const result = await prepareDocument(pages, 'ocr', io, controller.signal, () => {})
    expect(result.status).toBe('cancelled')
    expect(io.save).not.toHaveBeenCalled()
    expect(io.recognize).toHaveBeenCalledTimes(1)
  })

  it('reports persistence failures and empty OCR without inflating readable coverage', async () => {
    const { io } = harness()
    const signal = new AbortController().signal
    vi.mocked(io.save).mockRejectedValueOnce(new Error('Disk is full'))
    const first = await prepareDocument(preparationPages(2, []), 'text', io, signal, () => {})
    expect(first.pages[0]).toMatchObject({ status: 'failed', error: 'Disk is full' })
    vi.mocked(io.recognize).mockResolvedValue({ text: '', confidence: 0, language: 'eng' })
    const ocr = await prepareDocument(first.pages, 'ocr', io, signal, () => {})
    expect(ocr.pages[1]).toMatchObject({ status: 'needs-ocr', method: 'ocr' })
    expect(ocr.pages[1].error).toContain('no readable text')
    expect(ocr.pages.filter((item) => item.status === 'readable')).toHaveLength(0)
  })
})
