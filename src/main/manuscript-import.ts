import { readFileSync } from 'fs'
import { basename, extname } from 'path'
import {
  DOMParser,
  XMLSerializer,
  onErrorStopParsing,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode
} from '@xmldom/xmldom'
import JSZip from 'jszip'
import * as mammoth from 'mammoth'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import type { ParsedManuscriptDraft } from './revision-analysis'
import { parseManuscriptDraft } from './revision-analysis'

const MAX_SECTION_CHARACTERS = 500_000
const MAX_MANUSCRIPT_CHARACTERS = 5_000_000

function parseWordXml(xml: string): XmlDocument {
  return new DOMParser({ onError: onErrorStopParsing }).parseFromString(xml, 'application/xml')
}

function closestAncestor(node: XmlNode, name: string): XmlNode | null {
  let current: XmlNode | null = node.parentNode
  while (current) {
    if (current.nodeName === name) return current
    current = current.parentNode
  }
  return null
}

function runText(run: XmlElement): string {
  return Array.from(run.getElementsByTagName('w:t'))
    .filter((text) => closestAncestor(text, 'w:r') === run)
    .map((text) => text.textContent ?? '')
    .join('')
}

function extractWordComments(xml: string | null): string[] {
  if (!xml) return []
  const document = parseWordXml(xml)
  return Array.from(document.getElementsByTagName('w:comment'))
    .map((comment) =>
      Array.from(comment.getElementsByTagName('w:p'))
        .filter((paragraph) => closestAncestor(paragraph, 'w:comment') === comment)
        .map((paragraph) =>
          Array.from(paragraph.getElementsByTagName('w:r'))
            .filter((run) => closestAncestor(run, 'w:p') === paragraph)
            .map(runText)
            .join('')
            .trim()
        )
        .filter(Boolean)
        .join(' ')
    )
    .map((comment) => comment.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function separateColoredNotes(xml: string): { documentXml: string; comments: string[] } {
  const document = parseWordXml(xml)
  const comments: string[] = []
  for (const paragraph of Array.from(document.getElementsByTagName('w:p'))) {
    const colored: string[] = []
    const runs = Array.from(paragraph.getElementsByTagName('w:r')).filter(
      (run) => closestAncestor(run, 'w:p') === paragraph
    )
    for (const run of runs) {
      const properties = Array.from(run.childNodes).find((node) => node.nodeName === 'w:rPr') as
        XmlElement | undefined
      const colorElement = properties?.getElementsByTagName('w:color')[0]
      const color = colorElement?.getAttribute('w:val')?.toUpperCase()
      if (!color || ['AUTO', '000000', 'FFFFFF'].includes(color)) continue
      const text = runText(run)
      if (text) colored.push(text)
      run.parentNode?.removeChild(run)
    }
    const note = colored.join('').replace(/\s+/g, ' ').trim()
    if (note) comments.push(note)
  }
  return { documentXml: new XMLSerializer().serializeToString(document), comments }
}

function uniqueComments(comments: string[]): string[] {
  const seen = new Set<string>()
  return comments.filter((comment) => {
    const normalized = comment.replace(/\s+/g, ' ').trim()
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

function normalizeMammothTables(html: string): string {
  return html.replace(/<table\b[\s\S]*?<\/table>/gi, (table) => {
    const normalizedCells = table.replace(
      /<(td|th)(\b[^>]*)>([\s\S]*?)<\/\1>/gi,
      (_, tag: string, attributes: string, cell: string) => {
        const content = cell
          .replace(/<\/p>\s*<p\b[^>]*>/gi, '; ')
          .replace(/<\/?p\b[^>]*>/gi, '')
          .trim()
        return `<${tag}${attributes}>${content}</${tag}>`
      }
    )
    return normalizedCells.replace(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/i, (_, attributes, row) => {
      const header = row.replace(/<td(\b[^>]*)>/gi, '<th$1>').replace(/<\/td>/gi, '</th>')
      return `<tr${attributes}>${header}</tr>`
    })
  })
}

function htmlToMarkdown(html: string, fallbackTitle: string): string {
  const titleMatch = html.match(
    /<p[^>]*class="[^"]*\bmanuscript-title\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i
  )
  const withoutTitle = html
    .replace(/<p[^>]*class="[^"]*\bmanuscript-title\b[^"]*"[^>]*>[\s\S]*?<\/p>/i, '')
    .replace(/<(\/?)h([1-6])(\s[^>]*)?>/gi, (_, closing: string, level: string, rest = '') => {
      const shifted = Math.min(Number(level) + 1, 6)
      return `<${closing}h${shifted}${rest}>`
    })
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
    strongDelimiter: '**'
  })
  turndown.use(gfm)
  const title = titleMatch ? turndown.turndown(titleMatch[1]).trim() : fallbackTitle
  const body = turndown.turndown(normalizeMammothTables(withoutTitle)).trim()
  return `# ${title || fallbackTitle}${body ? `\n\n${body}` : ''}`
}

async function extractDocx(path: string, fallbackTitle: string): Promise<ParsedManuscriptDraft> {
  const bytes = readFileSync(path)
  const archive = await JSZip.loadAsync(bytes)
  const entries = Object.values(archive.files)
  if (entries.length > 5_000)
    throw new Error('The Word document contains too many archive entries.')
  let uncompressedBytes = 0
  for (const entry of entries) {
    const size = Number(
      (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0
    )
    if (!Number.isSafeInteger(size) || size < 0 || size > 100 * 1024 * 1024) {
      throw new Error('The Word document contains an unsafe archive entry.')
    }
    uncompressedBytes += size
    if (uncompressedBytes > 250 * 1024 * 1024) {
      throw new Error('The expanded Word document is too large to import safely.')
    }
  }
  const documentEntry = archive.file('word/document.xml')
  if (!documentEntry)
    throw new Error('The Word document does not contain a readable document body.')
  const separated = separateColoredNotes(await documentEntry.async('string'))
  archive.file('word/document.xml', separated.documentXml)
  const commentsEntry = archive.file('word/comments.xml')
  const wordComments = extractWordComments(
    commentsEntry ? await commentsEntry.async('string') : null
  )
  const manuscriptBytes = await archive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE'
  })
  const result = await mammoth.convertToHtml(
    { buffer: manuscriptBytes },
    {
      styleMap: ["p[style-name='Title'] => p.manuscript-title:fresh"],
      convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' }))
    }
  )
  const markdown = htmlToMarkdown(result.value, fallbackTitle)
  if (!markdown) throw new Error('No readable manuscript text was found in the Word document.')
  const draft = parseManuscriptDraft(markdown, fallbackTitle, [2])
  const reviewerComments = uniqueComments([...wordComments, ...separated.comments])
  return reviewerComments.length ? { ...draft, reviewerComments } : draft
}

async function extractPdf(path: string, fallbackTitle: string): Promise<ParsedManuscriptDraft> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(readFileSync(path))
  })
  const sections: ParsedManuscriptDraft['sections'] = []
  let extractedCharacters = 0
  try {
    const document = await loadingTask.promise
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      try {
        const content = await page.getTextContent()
        const lines: string[] = []
        let line = ''
        let lineY: number | null = null
        let previousLineY: number | null = null
        let previousXEnd: number | null = null
        let lineHeight = 0
        const flushLine = (): void => {
          if (!line.trim()) return
          if (
            previousLineY !== null &&
            lineY !== null &&
            Math.abs(lineY - previousLineY) > Math.max(12, lineHeight * 1.7)
          ) {
            lines.push('')
          }
          lines.push(line.trim())
          previousLineY = lineY
          line = ''
          previousXEnd = null
        }
        for (const item of content.items) {
          if (!('str' in item)) continue
          const x = item.transform[4]
          const y = item.transform[5]
          const height = Math.max(Math.abs(item.transform[3]), item.height || 0, 1)
          const newVisualLine =
            lineY !== null &&
            (Math.abs(y - lineY) > Math.max(2, lineHeight * 0.45) ||
              (previousXEnd !== null &&
                (x < previousXEnd - height || x - previousXEnd > Math.max(36, height * 3))))
          if (newVisualLine) {
            flushLine()
          }
          if (lineY === null || !line) lineY = y
          if (line && item.str && !/[\s-]$/.test(line) && !/^[,.;:!?)]/.test(item.str)) line += ' '
          line += item.str
          previousXEnd = x + item.width
          lineHeight = height
          if (item.hasEOL) {
            flushLine()
            lineY = null
          }
        }
        flushLine()
        const text = lines
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
        if (text) {
          extractedCharacters += text.length
          if (extractedCharacters > MAX_MANUSCRIPT_CHARACTERS) {
            throw new Error('The extracted manuscript text exceeds 5 million characters.')
          }
          sections.push({ title: `Page ${pageNumber}`, content: text })
        }
      } finally {
        page.cleanup()
      }
    }
  } finally {
    await loadingTask.destroy()
  }
  if (!sections.length) {
    throw new Error(
      'No selectable text was found in this PDF. Scanned PDFs must be OCR’d before manuscript import.'
    )
  }
  return { title: fallbackTitle, sections }
}

function editableDraft(draft: ParsedManuscriptDraft): ParsedManuscriptDraft {
  if (draft.title.length > 500) {
    throw new Error('The imported manuscript title is longer than 500 characters.')
  }
  const totalCharacters = draft.sections.reduce(
    (total, section) => total + section.content.length,
    0
  )
  if (totalCharacters > MAX_MANUSCRIPT_CHARACTERS) {
    throw new Error('The extracted manuscript text exceeds 5 million characters.')
  }
  const sections: ParsedManuscriptDraft['sections'] = []
  for (const section of draft.sections) {
    if (section.title.length > 500) {
      throw new Error('An imported section title is longer than 500 characters.')
    }
    const chunks: string[] = []
    let start = 0
    while (start < section.content.length || (!section.content.length && !chunks.length)) {
      let end = Math.min(start + MAX_SECTION_CHARACTERS, section.content.length)
      if (
        end < section.content.length &&
        end > start &&
        /[\uD800-\uDBFF]/.test(section.content[end - 1]) &&
        /[\uDC00-\uDFFF]/.test(section.content[end])
      ) {
        end -= 1
      }
      chunks.push(section.content.slice(start, end))
      start = end
      if (!section.content.length) break
    }
    for (let part = 0; part < chunks.length; part += 1) {
      const partCount = chunks.length
      const suffix = partCount > 1 ? ` (part ${part + 1})` : ''
      const title = `${section.title.slice(0, 500 - suffix.length)}${suffix}`
      sections.push({
        title,
        content: chunks[part]
      })
    }
  }
  if (!sections.length || sections.length > 10_000) {
    throw new Error('The manuscript could not be divided into editable sections.')
  }
  return draft.reviewerComments
    ? { title: draft.title, sections, reviewerComments: draft.reviewerComments }
    : { title: draft.title, sections }
}

export async function extractManuscript(path: string): Promise<ParsedManuscriptDraft> {
  const extension = extname(path).toLowerCase()
  const fallbackTitle = basename(path, extension)
  if (extension === '.txt' || extension === '.md') {
    return editableDraft(parseManuscriptDraft(readFileSync(path, 'utf8'), fallbackTitle))
  }
  if (extension === '.docx') return editableDraft(await extractDocx(path, fallbackTitle))
  if (extension === '.pdf') return editableDraft(await extractPdf(path, fallbackTitle))
  throw new Error('Choose a PDF, DOCX, TXT, or Markdown manuscript.')
}
