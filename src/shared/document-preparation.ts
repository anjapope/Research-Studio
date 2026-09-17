import type { DocumentPageSummary, DocumentPageText, OcrResult } from './domain'

export interface PreparationPage {
  page: number
  status: 'pending' | 'readable' | 'needs-ocr' | 'failed'
  method?: DocumentPageText['extractionMethod']
  error?: string
}

export interface PreparationProgress {
  status: 'idle' | 'running' | 'complete' | 'cancelled'
  pages: PreparationPage[]
  currentPage: number | null
  completed: number
  workTotal: number
}

export function preparationPages(total: number, saved: DocumentPageSummary[]): PreparationPage[] {
  const byPage = new Map(saved.map((item) => [item.page, item]))
  return Array.from({ length: total }, (_, index) => {
    const page = index + 1
    const record = byPage.get(page)
    return {
      page,
      status: record ? (record.readable ? 'readable' : 'needs-ocr') : 'pending',
      method: record?.extractionMethod
    }
  })
}

export interface PreparationIO {
  getSaved: (page: number) => Promise<DocumentPageText | null>
  extract: (page: number) => Promise<string>
  recognize: (page: number) => Promise<OcrResult>
  save: (
    page: number,
    text: string,
    method: 'pdf-text' | 'ocr',
    confidence?: number
  ) => Promise<DocumentPageText>
}

// Sequential, bounded work: successful pages are committed independently. Cancellation
// waits for the current operation but prevents subsequent extraction, OCR, and writes.
export async function prepareDocument(
  initial: PreparationPage[],
  mode: 'text' | 'ocr',
  io: PreparationIO,
  signal: AbortSignal,
  onProgress: (progress: PreparationProgress) => void
): Promise<PreparationProgress> {
  const pages = initial.map((item) => ({ ...item }))
  const targets = pages.filter(
    (item) => mode === 'text' || item.status === 'needs-ocr' || item.status === 'failed'
  )
  let completed = 0
  const publish = (
    status: PreparationProgress['status'],
    currentPage: number | null
  ): PreparationProgress => {
    const progress = {
      status,
      currentPage,
      completed,
      workTotal: targets.length,
      pages: pages.map((item) => ({ ...item }))
    }
    onProgress(progress)
    return progress
  }
  for (const item of targets) {
    if (signal.aborted) break
    publish('running', item.page)
    try {
      const saved = await io.getSaved(item.page)
      if (signal.aborted) break
      if (saved?.text.trim()) {
        Object.assign(item, {
          status: 'readable',
          method: saved.extractionMethod,
          error: undefined
        })
      } else {
        const method = mode === 'ocr' ? 'ocr' : 'pdf-text'
        item.method = method
        const result =
          mode === 'ocr'
            ? await io.recognize(item.page)
            : { text: await io.extract(item.page), confidence: undefined }
        if (signal.aborted) break
        const record = await io.save(item.page, result.text.trim(), method, result.confidence)
        Object.assign(item, {
          status: record.text.trim() ? 'readable' : 'needs-ocr',
          method: record.extractionMethod,
          error:
            !record.text.trim() && mode === 'ocr'
              ? 'Local OCR found no readable text. This may be a blank page.'
              : undefined
        })
      }
    } catch (error) {
      if (signal.aborted) break
      item.status = 'failed'
      item.error = error instanceof Error ? error.message : 'Page preparation failed.'
    }
    completed += 1
    publish('running', item.page)
  }
  return publish(signal.aborted ? 'cancelled' : 'complete', null)
}
