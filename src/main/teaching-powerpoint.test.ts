import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { powerpointPages, teachingPowerPoint } from './teaching-powerpoint'
import { parseTeachingSlides, slidesHtml, type Lesson } from '../shared/teaching'

const lesson: Lesson = {
  id: 'test',
  title: 'Evidence & interpretation',
  audience: 'Class',
  duration: 50,
  objectives: '',
  sources: [],
  notes: '',
  synthesis: '',
  slides:
    '# Evidence & interpretation\n- A visible point [S1]\n???\nInstructor-only explanation [S1]\n\n---\n\n# Discussion\nCompare the claims.'
}

describe('PowerPoint export', () => {
  it('exports editable widescreen text and speaker notes separately', async () => {
    const zip = await JSZip.loadAsync(await teachingPowerPoint(lesson))
    const slide = await zip.file('ppt/slides/slide1.xml')!.async('string')
    const notes = await zip.file('ppt/notesSlides/notesSlide1.xml')!.async('string')
    const presentation = await zip.file('ppt/presentation.xml')!.async('string')
    expect(slide).toContain('Evidence &amp; interpretation')
    expect(slide).toContain('A visible point [S1]')
    expect(slide).toContain('<a:buChar')
    expect(slide).not.toContain('Instructor-only')
    expect(notes).toContain('Instructor-only explanation [S1]')
    expect(presentation).toContain('cx="12192000"')
    expect(
      Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    ).toHaveLength(2)
    for (const file of Object.values(zip.files).filter((file) => file.name.endsWith('.xml'))) {
      const errors: string[] = []
      new DOMParser({
        onError: (level, message) => {
          if (level !== 'warning') errors.push(message)
        }
      }).parseFromString(await file.async('string'), 'application/xml')
      expect(errors).toEqual([])
    }
  })
  it('paginates long text without dropping words or exceeding the content area', async () => {
    const body = Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ')
    const pages = powerpointPages(body.repeat(5))
    expect(pages.length).toBeGreaterThan(1)
    expect(
      pages
        .flat()
        .map((paragraph) => paragraph.text)
        .join(' ')
    ).toBe(body.repeat(5))
    for (const page of pages)
      expect(page.reduce((height, paragraph) => height + paragraph.height, 0)).toBeLessThanOrEqual(
        4.8
      )
    const zip = await JSZip.loadAsync(
      await teachingPowerPoint({ ...lesson, slides: `# Long reading\n${body.repeat(5)}` })
    )
    expect(await zip.file('ppt/slides/slide2.xml')!.async('string')).toContain('(continued)')
  })
  it('keeps speaker notes out of HTML and parses legacy slides', () => {
    expect(slidesHtml(lesson)).not.toContain('Instructor-only')
    expect(parseTeachingSlides('# Legacy\nBody')).toEqual([
      { title: 'Legacy', body: 'Body', notes: '' }
    ])
    expect(parseTeachingSlides(lesson.slides)[0].notes).toContain('Instructor-only')
  })
  it('rejects empty decks', async () => {
    await expect(teachingPowerPoint({ ...lesson, slides: ' ' })).rejects.toThrow('Add slides')
  })
})
