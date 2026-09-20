import { dialog } from 'electron'
import { randomUUID } from 'crypto'
import { basename } from 'path'
import { statSync, writeFileSync } from 'fs'
import { z } from 'zod'
import { slidesHtml, type Lesson, type TeachingSource } from '../shared/teaching'
import type { WorkspaceDatabase } from './database'
import { extractManuscript } from './manuscript-import'
import { synthesizeLesson } from './teaching-ai'
import { TeachingSettings } from './teaching-settings'
import { teachingPowerPoint } from './teaching-powerpoint'

const lessonSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(500),
  audience: z.string().max(2000),
  duration: z.number().int().min(5).max(480),
  objectives: z.string().max(20000),
  sources: z
    .array(
      z.object({
        id: z.string().max(200),
        title: z.string().max(2000),
        text: z.string().max(5_000_000)
      })
    )
    .max(100),
  synthesis: z.string().max(5_000_000),
  notes: z.string().max(5_000_000),
  slides: z.string().max(5_000_000),
  generation: z
    .object({
      provider: z.literal('openai'),
      model: z.string().max(150),
      generatedAt: z.string().datetime(),
      sourceDigest: z.string().regex(/^[a-f0-9]{64}$/)
    })
    .optional()
})

export class TeachingService {
  readonly teachingSettings = new TeachingSettings()
  private teachingRequest: AbortController | null = null

  constructor(private readonly requireDatabase: () => WorkspaceDatabase) {}

  cancelTeachingSynthesis(): void {
    this.teachingRequest?.abort()
  }

  async synthesizeTeachingLesson(input: unknown): Promise<Lesson> {
    const database = this.requireDatabase()
    const lesson = lessonSchema.parse(input)
    if (this.teachingRequest) throw new Error('A teaching synthesis is already running.')
    const { model, apiKey } = this.teachingSettings.credentials()
    const controller = new AbortController()
    this.teachingRequest = controller
    const timer = setTimeout(() => controller.abort(), 180_000)
    try {
      const result = await synthesizeLesson(lesson, apiKey, model, controller.signal)
      if (controller.signal.aborted || database !== this.requireDatabase())
        throw new Error(
          'Synthesis was canceled or the workspace changed. Your drafts are unchanged.'
        )
      return result
    } finally {
      clearTimeout(timer)
      this.teachingRequest = null
    }
  }

  listLessons(): Lesson[] {
    return this.requireDatabase().listLessons()
  }

  saveLesson(input: unknown): Lesson {
    return this.requireDatabase().saveLesson(lessonSchema.parse(input))
  }

  async importTeachingDocuments(): Promise<TeachingSource[]> {
    const database = this.requireDatabase()
    const result = await dialog.showOpenDialog({
      title: 'Add class readings',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Readings', extensions: ['pdf', 'docx', 'md', 'txt'] }]
    })
    if (result.canceled) return []
    const sources: TeachingSource[] = []
    for (const path of result.filePaths) {
      if (statSync(path).size > 50 * 1024 * 1024)
        throw new Error(`${basename(path)} exceeds the 50 MB import limit.`)
      const parsed = await extractManuscript(path)
      const text = parsed.sections
        .map((section) => `${section.title}\n${section.content}`)
        .join('\n\n')
      if (!text.trim())
        throw new Error(`${basename(path)} has no readable text. Run OCR or paste a transcription.`)
      sources.push({ id: randomUUID(), title: basename(path), text })
    }
    if (database !== this.requireDatabase())
      throw new Error('Workspace changed during import. Please import again.')
    return sources
  }

  async exportLesson(input: unknown, format: unknown): Promise<boolean> {
    this.requireDatabase()
    const lesson = lessonSchema.parse(input)
    const kind = z.enum(['notes', 'slides', 'synthesis', 'pptx']).parse(format)
    if (!(kind === 'pptx' ? lesson.slides : lesson[kind]).trim())
      throw new Error('Add teaching material before exporting.')
    const extension = kind === 'pptx' ? 'pptx' : kind === 'slides' ? 'html' : 'md'
    const result = await dialog.showSaveDialog({
      title: 'Export teaching material',
      defaultPath: `${lesson.title.replace(/[<>:"/\\|?*]/g, '-')}-${kind}.${extension}`,
      filters: [
        {
          name:
            kind === 'pptx'
              ? 'PowerPoint presentation'
              : kind === 'slides'
                ? 'Browser slide deck'
                : 'Markdown',
          extensions: [extension]
        }
      ]
    })
    if (result.canceled || !result.filePath) return false
    if (kind === 'pptx') writeFileSync(result.filePath, await teachingPowerPoint(lesson))
    else
      writeFileSync(result.filePath, kind === 'slides' ? slidesHtml(lesson) : lesson[kind], 'utf8')
    return true
  }
}
