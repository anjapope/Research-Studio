import { describe, expect, it } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractPdfPage } from '../renderer/src/pdf-preparation'

// A real, three-page PDF: selectable text, a blank page, and unviewed text.
function fixturePdf(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  for (const text of ['First page evidence', '', 'Unviewed final page evidence']) {
    const contentId = objects.length + 2
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`
    )
    const content = text ? `BT /F1 12 Tf 72 720 Td (${text}) Tj 0 -24 Td (Second line) Tj ET` : ''
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`)
  }
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new Uint8Array(Buffer.from(pdf))
}

describe('PDF page extraction adapter', () => {
  it('extracts every page through PDF.js and preserves exposed line breaks', async () => {
    const task = getDocument({ data: fixturePdf(), useSystemFonts: true })
    try {
      const pdf = await task.promise
      expect(pdf.numPages).toBe(3)
      const pages: string[] = []
      for (let page = 1; page <= pdf.numPages; page += 1)
        pages.push(await extractPdfPage(pdf, page))
      expect(pages).toEqual([
        'First page evidence\nSecond line',
        '',
        'Unviewed final page evidence\nSecond line'
      ])
    } finally {
      await task.destroy()
    }
  })
})
