import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun
} from 'docx'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { extractManuscript } from './manuscript-import'

const paths: string[] = []

function temporary(): string {
  const path = mkdtempSync(join(tmpdir(), 'research-studio-manuscript-'))
  paths.push(path)
  return path
}

function simplePdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  ]
  let output = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output))
    output += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(output)
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(output)
}

afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('manuscript import', () => {
  it('extracts structured local DOCX manuscripts', async () => {
    const root = temporary()
    const path = join(root, 'article.docx')
    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: 'Submitted Article', heading: HeadingLevel.TITLE }),
            new Paragraph({ text: 'Introduction', heading: HeadingLevel.HEADING_1 }),
            new Paragraph({
              children: [
                new TextRun('Opening '),
                new TextRun({ text: 'claim', bold: true }),
                new TextRun(' and context.')
              ]
            }),
            new Paragraph({ text: 'First contribution', bullet: { level: 0 } }),
            new Paragraph({ text: 'Methods', heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ text: 'Sampling', heading: HeadingLevel.HEADING_2 }),
            new Paragraph('Participant recruitment and analysis.')
          ]
        }
      ]
    })
    writeFileSync(path, await Packer.toBuffer(document))

    expect(await extractManuscript(path)).toEqual({
      title: 'Submitted Article',
      sections: [
        {
          title: 'Introduction',
          content: 'Opening **claim** and context.\n\n-   First contribution'
        },
        {
          title: 'Methods',
          content: '### Sampling\n\nParticipant recruitment and analysis.'
        }
      ]
    })
  })

  it('preserves common Word formatting as editable Markdown', async () => {
    const root = temporary()
    const path = join(root, 'formatted.docx')
    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: 'Formatted', heading: HeadingLevel.TITLE }),
            new Paragraph({ text: 'Findings', heading: HeadingLevel.HEADING_1 }),
            new Paragraph({
              children: [
                new TextRun({ text: 'Emphasis', italics: true }),
                new TextRun(' and '),
                new ExternalHyperlink({
                  link: 'https://example.com',
                  children: [new TextRun({ text: 'evidence', style: 'Hyperlink' })]
                })
              ]
            }),
            new Table({
              rows: [
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph('Theme')] }),
                    new TableCell({ children: [new Paragraph('Count')] })
                  ]
                }),
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph('Trust')] }),
                    new TableCell({ children: [new Paragraph('4')] })
                  ]
                })
              ]
            })
          ]
        }
      ]
    })
    writeFileSync(path, await Packer.toBuffer(document))

    const imported = await extractManuscript(path)
    expect(imported.sections).toHaveLength(1)
    expect(imported.sections[0].content).toContain('_Emphasis_ and [evidence](https://example.com)')
    expect(imported.sections[0].content).toContain('| Theme | Count |')
    expect(imported.sections[0].content).toContain('| Trust | 4 |')
  })

  it('separates directly colored Word annotations from manuscript prose', async () => {
    const root = temporary()
    const path = join(root, 'annotated.docx')
    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: 'Annotated article', heading: HeadingLevel.TITLE }),
            new Paragraph({ text: 'Discussion', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('The original argument remains in the manuscript.'),
            new Paragraph({
              children: [
                new TextRun({ text: 'Reviewer: explain why this follows.', color: 'C00000' })
              ]
            })
          ]
        }
      ]
    })
    writeFileSync(path, await Packer.toBuffer(document))

    expect(await extractManuscript(path)).toEqual({
      title: 'Annotated article',
      sections: [
        {
          title: 'Discussion',
          content: 'The original argument remains in the manuscript.'
        }
      ],
      reviewerComments: ['Reviewer: explain why this follows.']
    })
  })

  it('extracts multi-paragraph Word comments without joining their words', async () => {
    const root = temporary()
    const path = join(root, 'commented.docx')
    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: 'Commented article', heading: HeadingLevel.TITLE }),
            new Paragraph({ text: 'Methods', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('Original methods text.')
          ]
        }
      ]
    })
    const archive = await JSZip.loadAsync(await Packer.toBuffer(document))
    archive.file(
      'word/comments.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
       <w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
         <w:comment w:id="0" w:author="Reviewer">
           <w:p><w:r><w:t>Clarify</w:t></w:r></w:p>
           <w:p><w:r><w:t>the methodology.</w:t></w:r></w:p>
         </w:comment>
       </w:comments>`
    )
    writeFileSync(path, await archive.generateAsync({ type: 'nodebuffer' }))

    expect((await extractManuscript(path)).reviewerComments).toEqual(['Clarify the methodology.'])
  })

  it('uses the filename when a Word draft has headings but no explicit title', async () => {
    const root = temporary()
    const path = join(root, 'heading-only.docx')
    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: 'Introduction', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('Opening body.'),
            new Paragraph({ text: 'Methods', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('Study design.')
          ]
        }
      ]
    })
    writeFileSync(path, await Packer.toBuffer(document))

    expect(await extractManuscript(path)).toEqual({
      title: 'heading-only',
      sections: [
        { title: 'Introduction', content: 'Opening body.' },
        { title: 'Methods', content: 'Study design.' }
      ]
    })
  })

  it('extracts selectable text from local PDF manuscripts', async () => {
    const root = temporary()
    const path = join(root, 'article.pdf')
    writeFileSync(path, simplePdf('Local PDF manuscript text'))

    expect(await extractManuscript(path)).toEqual({
      title: 'article',
      sections: [{ title: 'Page 1', content: 'Local PDF manuscript text' }]
    })
  })

  it('splits long imported text into sections that remain editable', async () => {
    const root = temporary()
    const path = join(root, 'long-draft.txt')
    writeFileSync(path, 'a'.repeat(500_001))

    const imported = await extractManuscript(path)
    expect(imported.sections).toEqual([
      { title: 'Imported draft (part 1)', content: 'a'.repeat(500_000) },
      { title: 'Imported draft (part 2)', content: 'a' }
    ])

    writeFileSync(path, `${'a'.repeat(499_999)}😀b`)
    const unicode = await extractManuscript(path)
    expect(unicode.sections.map((section) => section.content).join('')).toBe(
      `${'a'.repeat(499_999)}😀b`
    )
    expect(unicode.sections[0].content.endsWith('\ud83d')).toBe(false)
  })
})
