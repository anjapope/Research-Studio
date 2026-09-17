import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { draftLesson, slidesHtml, type Lesson } from '../shared/teaching'
import { WorkspaceDatabase } from './database'

const lesson: Lesson = {
  id: 'd7d31186-849b-414f-a4de-24d2887ec189',
  title: 'Evidence and interpretation',
  audience: 'Undergraduates',
  duration: 50,
  objectives: 'Compare how authors interpret evidence.',
  sources: [
    {
      id: 'a',
      title: 'First reading',
      text: 'Evidence supports an interpretation when its context is carefully considered. Researchers should compare their explanations with alternative accounts.'
    },
    {
      id: 'b',
      title: 'Second reading',
      text: 'Evidence can challenge the assumptions that researchers bring to a question. Interpretation requires attention to the limits of the available material.'
    }
  ],
  synthesis: '',
  notes: '',
  slides: ''
}

describe('teaching lessons', () => {
  it('links verbatim extracts and shared terms to each reading', () => {
    const draft = draftLesson(lesson)
    expect(draft.synthesis).toContain('evidence: [S1], [S2]')
    for (const source of lesson.sources)
      expect(draft.synthesis).toContain(source.text.split('. ')[0])
    expect(draft.notes).toContain('[S2] Second reading')
    expect(draft.slides.split('\n\n---\n\n')).toHaveLength(7)
    expect(draft.synthesis).toContain('not agreement')
  })
  it('rejects unreadable readings rather than shifting source references', () => {
    expect(() => draftLesson({ ...lesson, sources: [] })).toThrow('readable')
    expect(() =>
      draftLesson({
        ...lesson,
        sources: [{ id: 'empty', title: 'Scan', text: '' }, ...lesson.sources]
      })
    ).toThrow('Each reading')
  })
  it('escapes source markup in the standalone slide deck', () => {
    const html = slidesHtml({
      ...lesson,
      slides: '# <script>alert(1)</script>\n\n---\n\n# Next slide'
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html.match(/<section>/g)).toHaveLength(2)
  })
  it('persists edits across reopen and isolates workspaces', () => {
    const path = mkdtempSync(join(tmpdir(), 'teaching-test-'))
    const first = new WorkspaceDatabase(join(path, 'first'))
    const second = new WorkspaceDatabase(join(path, 'second'))
    let reopened: WorkspaceDatabase | undefined
    try {
      first.saveLesson(lesson)
      first.saveLesson({ ...lesson, notes: 'Instructor edits' })
      expect(first.listLessons()).toHaveLength(1)
      expect(second.listLessons()).toEqual([])
      first.close()
      reopened = new WorkspaceDatabase(join(path, 'first'))
      expect(reopened.listLessons()[0].notes).toBe('Instructor edits')
      expect(reopened.listLessons()[0].sources).toEqual(lesson.sources)
    } finally {
      reopened?.close()
      second.close()
      rmSync(path, { recursive: true, force: true })
    }
  })
})
