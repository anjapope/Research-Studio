import pptxgen from 'pptxgenjs'
import { parseTeachingSlides, type Lesson } from '../shared/teaching'

function plain(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s*/, '')
}

interface Paragraph {
  text: string
  bullet: boolean
  height: number
}
export function powerpointPages(body: string): Paragraph[][] {
  const paragraphs: Paragraph[] = []
  for (const line of body.split('\n').filter((value) => value.trim())) {
    const bullet = /^\s*[-*+]\s+/.test(line)
    const text = plain(line.replace(/^\s*[-*+]\s+/, '')).trim()
    // Conservative wrapping at 62 characters for 24pt text in a wide slide.
    const words = text.match(/\S+/g) ?? []
    if (words.some((word) => word.length > 248))
      throw new Error(
        'A slide contains an unusually long unbroken word or URL. Shorten it or move it to speaker notes before exporting.'
      )
    let segment = ''
    for (const word of words) {
      if ((segment + ' ' + word).length > 248) {
        paragraphs.push({
          text: segment,
          bullet,
          height: Math.ceil(segment.length / 62) * 0.43 + 0.13
        })
        segment = ''
      }
      segment += `${segment ? ' ' : ''}${word}`
    }
    if (segment)
      paragraphs.push({
        text: segment,
        bullet,
        height: Math.ceil(segment.length / 62) * 0.43 + 0.13
      })
  }
  const pages: Paragraph[][] = [[]]
  let height = 0
  for (const paragraph of paragraphs) {
    if (height + paragraph.height > 4.8 && pages[pages.length - 1].length) {
      pages.push([])
      height = 0
    }
    pages[pages.length - 1].push(paragraph)
    height += paragraph.height
  }
  return pages
}

export async function teachingPowerPoint(lesson: Lesson): Promise<Buffer> {
  const input = parseTeachingSlides(lesson.slides)
  if (!input.length) throw new Error('Add slides before exporting PowerPoint.')
  if (input.length > 100 || lesson.slides.length > 200_000)
    throw new Error(
      'Split this deck into smaller lessons before exporting (maximum 100 input slides / 200,000 characters).'
    )
  const deck = new pptxgen()
  deck.layout = 'LAYOUT_WIDE'
  deck.author = 'Research Studio'
  deck.subject = lesson.audience
  deck.title = lesson.title
  deck.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos' }
  let count = 0
  for (const source of input) {
    if (source.title.length > 150)
      throw new Error(
        'A slide title exceeds 150 characters. Shorten it before exporting PowerPoint.'
      )
    const pages = powerpointPages(source.body)
    for (const [index, paragraphs] of pages.entries()) {
      const slide = deck.addSlide()
      slide.background = { color: 'F8F8F3' }
      const title = `${plain(source.title)}${index ? ' (continued)' : ''}`
      slide.addText(title, {
        x: 0.7,
        y: 0.45,
        w: 11.9,
        h: 1.05,
        fontFace: 'Aptos Display',
        fontSize: 32,
        bold: true,
        color: '183E38',
        margin: 0,
        valign: 'middle',
        breakLine: false,
        fit: 'shrink'
      })
      let y = 1.7
      for (const paragraph of paragraphs) {
        slide.addText(paragraph.text, {
          x: 0.8,
          y,
          w: 11.7,
          h: paragraph.height,
          fontFace: 'Aptos',
          fontSize: 24,
          color: '253E38',
          margin: 0,
          valign: 'top',
          breakLine: false,
          fit: 'shrink',
          ...(paragraph.bullet ? { bullet: { indent: 22 }, hanging: 5 } : {})
        })
        y += paragraph.height
      }
      slide.addText(String(++count), {
        x: 11.9,
        y: 7.05,
        w: 0.7,
        h: 0.2,
        fontSize: 11,
        color: '5D7069',
        align: 'right',
        margin: 0
      })
      slide.addNotes(source.notes || `Lecture: ${lesson.title}\n\n${source.body}`)
    }
  }
  return (await deck.write({ outputType: 'nodebuffer', compression: true })) as Buffer
}
