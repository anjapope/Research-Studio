import { readFileSync } from 'fs'

export interface ExtractionResult {
  extractionStatus: 'extracted' | 'needs-ocr'
  text: string
  pageCount: number | null
  warnings: string[]
  extractor: string
}

function normalizeText(value: string): { text: string; normalized: boolean } {
  const normalized = value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  return { text: normalized, normalized: normalized !== value }
}

export function extractPlainText(path: string, extension: 'txt' | 'md'): ExtractionResult {
  const { text, normalized } = normalizeText(readFileSync(path, 'utf8'))
  return {
    extractionStatus: 'extracted',
    text,
    pageCount: null,
    warnings: normalized ? ['newline-normalization'] : [],
    extractor: `research-studio-${extension}-extractor/1`
  }
}

export async function extractPdf(path: string): Promise<ExtractionResult> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)) })
  const pages: string[] = []
  let pageCount = 0
  try {
    const document = await loadingTask.promise
    pageCount = document.numPages
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      try {
        const content = await page.getTextContent()
        const text = content.items
          .filter((item): item is typeof item & { str: string } => 'str' in item)
          .map((item) => item.str)
          .join('')
          .replace(/\s+\n/g, '\n')
          .replace(/\n\s+/g, '\n')
          .trim()
        pages.push(text)
      } finally {
        page.cleanup()
      }
    }
  } finally {
    await loadingTask.destroy()
  }
  const hasText = pages.some((page) => page.length > 0)
  const text = hasText
    ? pages
        .map((page, index) => `--- Page ${index + 1} ---\n\n${page}`)
        .join('\n\n')
        .trim()
    : ''
  return {
    extractionStatus: text ? 'extracted' : 'needs-ocr',
    text,
    pageCount,
    warnings: text ? [] : ['No embedded PDF text was found; OCR is required.'],
    extractor: 'research-studio-pdf-extractor/1'
  }
}

export async function extractDocument(path: string, extension: string): Promise<ExtractionResult> {
  if (extension === 'txt' || extension === 'md') return extractPlainText(path, extension)
  if (extension === 'pdf') return extractPdf(path)
  throw new Error(`unsupported-file-type: .${extension || '(none)'}`)
}
