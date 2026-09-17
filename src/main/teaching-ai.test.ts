import { describe, expect, it, vi } from 'vitest'
import { synthesizeLesson, teachingInput } from './teaching-ai'
import type { Lesson } from '../shared/teaching'

const lesson: Lesson = {
  id: 'test',
  title: 'Interpretation',
  audience: 'Undergraduates',
  duration: 50,
  objectives: 'Compare evidence',
  sources: [
    { id: 'source', title: 'A reading', text: 'A source sentence about interpreting evidence.' }
  ],
  synthesis: 'Existing synthesis',
  notes: 'Private instructor edits',
  slides: '# Existing slides'
}
const valid = {
  synthesis: 'The reading argues for careful interpretation [S1].',
  notes: 'Explain evidence [S1].',
  slides: '# Interpretation\n- Evidence [S1]\n???\nExplain context [S1].'
}
const completed = (draft: unknown): Response =>
  Response.json({
    status: 'completed',
    model: 'test-model',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(draft) }] }]
  })

describe('AI lesson synthesis', () => {
  it('sends only selected lesson context, uses structured outputs, and appends known sources', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(completed(valid))
    const result = await synthesizeLesson(
      lesson,
      'test-key',
      'test-model',
      new AbortController().signal,
      request
    )
    const [url, options] = request.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/responses')
    const body = JSON.parse(String(options?.body))
    expect(body.store).toBe(false)
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true })
    expect(body.input).toContain(lesson.sources[0].text)
    expect(body.input).not.toContain('Private instructor edits')
    expect(result.notes).toContain('[S1] A reading')
    expect(result.generation).toMatchObject({ provider: 'openai', model: 'test-model' })
    expect(result.generation?.sourceDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(lesson.notes).toBe('Private instructor edits')
  })
  it.each([401, 403, 404, 429, 500])(
    'reports HTTP %i without exposing raw response content',
    async (status) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('test-key secret response', { status }))
      await expect(
        synthesizeLesson(lesson, 'test-key', 'test-model', new AbortController().signal, request)
      ).rejects.not.toThrow('test-key')
    }
  )
  it.each([
    { ...valid, synthesis: 'No citation' },
    { ...valid, notes: 'Invented [S8]' },
    { ...valid, slides: '' },
    { synthesis: 'wrong shape' }
  ])('rejects invalid draft without changing the lesson', async (draft) => {
    await expect(
      synthesizeLesson(
        lesson,
        'key',
        'model',
        new AbortController().signal,
        vi.fn<typeof fetch>().mockResolvedValue(completed(draft))
      )
    ).rejects.toThrow()
    expect(lesson.synthesis).toBe('Existing synthesis')
  })
  it('does not send empty or oversized readings', async () => {
    const request = vi.fn<typeof fetch>()
    await expect(
      synthesizeLesson(
        { ...lesson, sources: [] },
        'key',
        'model',
        new AbortController().signal,
        request
      )
    ).rejects.toThrow('readable')
    expect(() =>
      teachingInput({ ...lesson, sources: [{ ...lesson.sources[0], text: 'a'.repeat(240_001) }] })
    ).toThrow('No text was sent')
    expect(request).not.toHaveBeenCalled()
  })
  it('rejects incomplete responses and refusals', async () => {
    for (const response of [
      Response.json({ status: 'incomplete', output: [] }),
      Response.json({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'refusal' }] }]
      })
    ]) {
      await expect(
        synthesizeLesson(
          lesson,
          'key',
          'model',
          new AbortController().signal,
          vi.fn<typeof fetch>().mockResolvedValue(response)
        )
      ).rejects.toThrow('unchanged')
    }
  })
  it('handles cancellation without replacing the original lesson', async () => {
    const controller = new AbortController()
    const request = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort()
      throw new Error('network details')
    })
    await expect(
      synthesizeLesson(lesson, 'key', 'model', controller.signal, request)
    ).rejects.toThrow('canceled')
  })
})
