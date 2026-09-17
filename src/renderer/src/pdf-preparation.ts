import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { OcrResult } from '../../shared/domain'

export async function extractPdfPage(pdf: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await pdf.getPage(pageNumber)
  const content = await page.getTextContent()
  return content.items
    .flatMap((item) => ('str' in item ? [item.str, item.hasEOL ? '\n' : ' '] : []))
    .join('')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
}

export async function recognizePdfPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  signal: AbortSignal,
  recognize: (image: Uint8Array) => Promise<OcrResult>
): Promise<OcrResult> {
  const page = await pdf.getPage(pageNumber)
  signal.throwIfAborted()
  const base = page.getViewport({ scale: 1 })
  // Bound memory on unusually large pages, while rendering ordinary pages at 144 DPI.
  const scale = Math.min(
    2,
    4096 / Math.max(base.width, base.height),
    Math.sqrt(12_000_000 / (base.width * base.height))
  )
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas rendering is unavailable.')
  const task = page.render({ canvas, canvasContext: context, viewport })
  const cancel = (): void => task.cancel()
  signal.addEventListener('abort', cancel, { once: true })
  try {
    await task.promise
    signal.throwIfAborted()
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('Could not capture PDF page.'))),
        'image/png'
      )
    )
    signal.throwIfAborted()
    const bytes = new Uint8Array(await blob.arrayBuffer())
    signal.throwIfAborted()
    return await recognize(bytes)
  } finally {
    signal.removeEventListener('abort', cancel)
    canvas.width = 0
    canvas.height = 0
  }
}
