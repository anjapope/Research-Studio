import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Lesson } from '../shared/teaching'

const state = vi.hoisted(() => ({
  openDialog: vi.fn(),
  saveDialog: vi.fn(),
  synthesize: vi.fn(),
  extract: vi.fn(),
  pptx: vi.fn()
}))

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: state.openDialog,
    showSaveDialog: state.saveDialog
  }
}))

vi.mock('./teaching-ai', () => ({
  synthesizeLesson: state.synthesize
}))

vi.mock('./manuscript-import', () => ({
  extractManuscript: state.extract
}))

vi.mock('./teaching-powerpoint', () => ({
  teachingPowerPoint: state.pptx
}))

vi.mock('./teaching-settings', () => ({
  TeachingSettings: class {
    credentials(): { model: string; apiKey: string } {
      return { model: 'test-model', apiKey: 'test-key' }
    }
  }
}))

import { TeachingService } from './teaching-service'

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
      text: 'Evidence supports an interpretation when its context is carefully considered.'
    }
  ],
  synthesis: 'Draft synthesis',
  notes: 'Instructor notes',
  slides: '# Slide title'
}

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('TeachingService', () => {
  it('delegates lesson persistence to the active workspace database', () => {
    const saved = { ...lesson, notes: 'Updated notes' }
    const database = {
      listLessons: vi.fn().mockReturnValue([lesson]),
      saveLesson: vi.fn().mockReturnValue(saved)
    }
    const service = new TeachingService(() => database as never)

    expect(service.listLessons()).toEqual([lesson])
    expect(service.saveLesson(saved)).toEqual(saved)
    expect(database.listLessons).toHaveBeenCalledTimes(1)
    expect(database.saveLesson).toHaveBeenCalledWith(saved)
  })

  it('rejects concurrent synthesis requests', async () => {
    let resolveSynthesis: ((value: Lesson) => void) | undefined
    state.synthesize.mockImplementation(
      () =>
        new Promise<Lesson>((resolve) => {
          resolveSynthesis = resolve
        })
    )
    const database = {}
    const service = new TeachingService(() => database as never)

    const first = service.synthesizeTeachingLesson(lesson)
    await expect(service.synthesizeTeachingLesson(lesson)).rejects.toThrow('already running')

    resolveSynthesis?.({ ...lesson, synthesis: 'Completed synthesis' })
    await expect(first).resolves.toMatchObject({ synthesis: 'Completed synthesis' })
  })

  it('rejects synthesis results if the workspace changes before completion', async () => {
    const firstDatabase = {}
    const secondDatabase = {}
    let currentDatabase = firstDatabase
    state.synthesize.mockImplementation(async () => {
      currentDatabase = secondDatabase
      return { ...lesson, synthesis: 'Completed synthesis' }
    })
    const service = new TeachingService(() => currentDatabase as never)

    await expect(service.synthesizeTeachingLesson(lesson)).rejects.toThrow('workspace changed')
  })

  it('aborts synthesis when canceled or timed out', async () => {
    vi.useFakeTimers()
    state.synthesize.mockImplementation(
      (_lesson, _apiKey, _model, signal: AbortSignal) =>
        new Promise<Lesson>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('canceled by test')), {
            once: true
          })
        })
    )
    const database = {}
    const service = new TeachingService(() => database as never)

    const canceled = service.synthesizeTeachingLesson(lesson)
    const canceledAssertion = expect(canceled).rejects.toThrow('canceled by test')
    service.cancelTeachingSynthesis()
    await canceledAssertion

    const timedOut = service.synthesizeTeachingLesson(lesson)
    const timedOutAssertion = expect(timedOut).rejects.toThrow('canceled by test')
    await vi.advanceTimersByTimeAsync(180_000)
    await timedOutAssertion
  })

  it('imports readable teaching documents and preserves the active workspace boundary', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'teaching-service-import-'))
    const filePath = join(directory, 'reading.md')
    writeFileSync(filePath, '# Reading')
    state.openDialog.mockResolvedValue({ canceled: false, filePaths: [filePath] })
    state.extract.mockResolvedValue({
      sections: [
        { title: 'Introduction', content: 'First paragraph' },
        { title: 'Conclusion', content: 'Second paragraph' }
      ]
    })
    const database = {}
    const service = new TeachingService(() => database as never)

    try {
      await expect(service.importTeachingDocuments()).resolves.toEqual([
        {
          id: expect.any(String),
          title: basename(filePath),
          text: 'Introduction\nFirst paragraph\n\nConclusion\nSecond paragraph'
        }
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('exports lesson notes through the existing save dialog flow', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'teaching-service-export-'))
    const filePath = join(directory, 'lesson-notes.md')
    state.saveDialog.mockResolvedValue({ canceled: false, filePath })
    const database = {}
    const service = new TeachingService(() => database as never)

    try {
      await expect(service.exportLesson(lesson, 'notes')).resolves.toBe(true)
      expect(readFileSync(filePath, 'utf8')).toBe(lesson.notes)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
