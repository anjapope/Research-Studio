import { Cite } from '@citation-js/core'
import '@citation-js/plugin-bibtex'
import '@citation-js/plugin-csl'
import type { LibraryFormat, Source, SourceDraft, SourceType } from '../shared/domain'

type CslRecord = Record<string, unknown>

const sourceToCslType: Record<SourceType, string> = {
  article: 'article-journal',
  book: 'book',
  chapter: 'chapter',
  report: 'report',
  thesis: 'thesis',
  web: 'webpage',
  other: 'document'
}

const cslToSourceType: Record<string, SourceType> = {
  'article-journal': 'article',
  article: 'article',
  book: 'book',
  chapter: 'chapter',
  'chapter-book': 'chapter',
  report: 'report',
  thesis: 'thesis',
  webpage: 'web',
  post: 'web',
  document: 'other'
}

function record(value: unknown): CslRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as CslRecord)
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function textFirst(value: unknown): string | null {
  return Array.isArray(value) ? text(value[0]) : text(value)
}

function webUrl(value: unknown): string | null {
  const candidate = text(value)
  if (!candidate) return null
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? candidate : null
  } catch {
    return null
  }
}

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const name = record(entry)
    if (!name) return []
    const literal = text(name.literal)
    if (literal) return [literal]
    const given = text(name.given)
    const family = text(name.family)
    const display = [given, family].filter(Boolean).join(' ')
    return display ? [display] : []
  })
}

function year(value: unknown): number | null {
  const issued = record(value)
  const dateParts = issued?.['date-parts']
  if (!Array.isArray(dateParts) || !Array.isArray(dateParts[0])) return null
  const candidate = dateParts[0][0]
  return typeof candidate === 'number' && Number.isInteger(candidate) ? candidate : null
}

function keywords(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => (text(item) ? [text(item)!] : []))
  const valueText = text(value)
  return valueText
    ? valueText
        .split(/[,;]/)
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

export function parseLibrary(
  content: string,
  format: LibraryFormat,
  fileName: string
): SourceDraft[] {
  let data: unknown[]
  if (format === 'csl-json') {
    const parsed: unknown = JSON.parse(content)
    data = Array.isArray(parsed) ? parsed : [parsed]
  } else {
    if (!content.includes('@'))
      throw new Error('This file does not contain recognizable BibTeX entries.')
    data = new Cite(content).data
  }

  const importedAt = new Date().toISOString()
  return data.map((entry, index) => {
    const item = record(entry)
    if (!item) throw new Error(`Citation ${index + 1} is not a valid record.`)
    const title = text(item.title)
    if (!title) throw new Error(`Citation ${index + 1} has no title.`)
    const cslType = text(item.type) ?? 'document'
    return {
      title,
      sourceType: cslToSourceType[cslType] ?? 'other',
      status: 'unread',
      authors: names(item.author),
      year: year(item.issued),
      publicationTitle: textFirst(item['container-title']),
      publisher: text(item.publisher),
      doi: text(item.DOI),
      url: webUrl(item.URL),
      abstract: text(item.abstract),
      notes: text(item.note),
      tags: keywords(item.keyword),
      origin: 'imported',
      provenanceNote: `Imported from ${fileName} on ${importedAt}.`
    }
  })
}

export function sourceToCsl(source: Source): CslRecord {
  return {
    id: source.id,
    type: sourceToCslType[source.sourceType],
    title: source.title,
    author: source.authors.map((author) => ({ literal: author.displayName })),
    ...(source.year ? { issued: { 'date-parts': [[source.year]] } } : {}),
    ...(source.publicationTitle ? { 'container-title': source.publicationTitle } : {}),
    ...(source.publisher ? { publisher: source.publisher } : {}),
    ...(source.doi ? { DOI: source.doi } : {}),
    ...(source.url ? { URL: source.url } : {}),
    ...(source.abstract ? { abstract: source.abstract } : {}),
    ...(source.notes ? { note: source.notes } : {}),
    ...(source.tags.length ? { keyword: source.tags.join(', ') } : {})
  }
}

export function exportLibrary(sources: Source[], format: LibraryFormat): string {
  const data = sources.map(sourceToCsl)
  return format === 'csl-json'
    ? `${JSON.stringify(data, null, 2)}\n`
    : new Cite(data).format('bibtex')
}
