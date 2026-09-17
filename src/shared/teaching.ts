export interface TeachingSource {
  id: string
  title: string
  text: string
}

export interface Lesson {
  id: string
  title: string
  audience: string
  duration: number
  objectives: string
  sources: TeachingSource[]
  synthesis: string
  notes: string
  slides: string
  generation?: {
    provider: 'openai'
    model: string
    generatedAt: string
    sourceDigest: string
  }
}

export interface TeachingAiSettings {
  model: string
  hasKey: boolean
  canStoreKey: boolean
}

export interface TeachingAiSettingsDraft {
  model: string
  apiKey?: string
  removeKey?: boolean
}
export type TeachingExportFormat = 'notes' | 'slides' | 'synthesis' | 'pptx'

export function parseTeachingSlides(
  markdown: string
): Array<{ title: string; body: string; notes: string }> {
  return markdown
    .split(/^\s*---\s*$/m)
    .filter((part) => part.trim())
    .map((part, index) => {
      const [visible, ...notes] = part.split(/^\s*\?\?\?\s*$/m)
      const lines = visible.trim().split('\n')
      const hasTitle = /^#\s+/.test(lines[0])
      return {
        title: hasTitle ? lines.shift()!.replace(/^#\s+/, '') : `Slide ${index + 1}`,
        body: lines.join('\n').trim(),
        notes: notes.join('\n').trim()
      }
    })
}

const stop = new Set(
  'about after again also among because been before being between both could does each from have into more most other over same should some such than that their them then there these they this those through under very were what when where which while with would your'.split(
    ' '
  )
)
function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((word) => !stop.has(word))
}

export function draftLesson(lesson: Lesson): Pick<Lesson, 'synthesis' | 'notes' | 'slides'> {
  const sources = lesson.sources.filter((source) => source.text.trim())
  if (!sources.length) throw new Error('Add readable source text before drafting.')
  if (sources.length !== lesson.sources.length)
    throw new Error(
      'Each reading needs source text. Fill in or remove empty readings before drafting.'
    )
  const focus = new Set(words(`${lesson.title} ${lesson.objectives}`))
  const frequencies = new Map<string, number>()
  sources.forEach((source) =>
    new Set(words(source.text)).forEach((word) =>
      frequencies.set(word, (frequencies.get(word) ?? 0) + 1)
    )
  )
  const themes = [...frequencies]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
  const extracts = sources.map((source, index) => {
    const sentences =
      source.text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+(?:["”])?|[^.!?]+$/g) ?? []
    const ranked = sentences
      .map((text, position) => ({
        text: text.trim(),
        position,
        score:
          words(text).reduce(
            (score, word) => score + (focus.has(word) ? 4 : 0) + (frequencies.get(word) ?? 0),
            0
          ) / Math.sqrt(Math.max(text.length, 1))
      }))
      .filter((item) => item.text.length > 35)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .sort((a, b) => a.position - b.position)
    const quotes = ranked.length ? ranked.map((item) => item.text) : [source.text.trim()]
    return { title: source.title, marker: `[S${index + 1}]`, quotes }
  })
  const references = extracts.map((item) => `${item.marker} ${item.title}`).join('\n')
  const evidence = extracts
    .map(
      (item) =>
        `### ${item.title} ${item.marker}\n\n${item.quotes.map((quote) => `> ${quote}`).join('\n\n')}`
    )
    .join('\n\n')
  const comparisons = themes
    .map(
      ([word]) =>
        `- ${word}: ${sources.flatMap((source, index) => (words(source.text).includes(word) ? [`[S${index + 1}]`] : [])).join(', ')}. Compare how these readings use this term.`
    )
    .join('\n')
  return {
    synthesis: `## Reading synthesis — extractive draft\n\nSelected passages from ${sources.length} readings; review in context. Shared vocabulary indicates possible discussion themes, not agreement between authors.\n\n${comparisons || 'No repeated key terms found across the readings. Compare each author’s central claim manually.'}\n\n${evidence}\n\n## Sources\n${references}`,
    notes: `# ${lesson.title}\n\nAudience: ${lesson.audience || 'Not specified'} | ${lesson.duration} minutes\n\n## Learning objectives\n${lesson.objectives || 'Add measurable learning objectives.'}\n\n## Opening (${Math.round(lesson.duration * 0.1)} minutes)\nAsk students what they already know about ${lesson.title}.\n\n## Reading discussion (${Math.round(lesson.duration * 0.6)} minutes)\n\n${evidence}\n\nFor each reading: explain the claim in your own words, examine its evidence, and add a classroom example.\n\n## Compare and apply (${Math.round(lesson.duration * 0.2)} minutes)\n${comparisons}\n\nAsk pairs to identify one agreement and one tension, citing a passage from each reading.\n\n## Exit ticket (${lesson.duration - Math.round(lesson.duration * 0.1) - Math.round(lesson.duration * 0.6) - Math.round(lesson.duration * 0.2)} minutes)\nWhat claim can you now explain, and what question remains?\n\n## Sources\n${references}`,
    slides: [
      `# ${lesson.title}\n${lesson.audience}`,
      `# Learning objectives\n${lesson.objectives || 'Add learning objectives.'}`,
      ...extracts.map(
        (item) =>
          `# ${item.title}\n${item.quotes.map((quote) => `> ${quote}`).join('\n\n')}\n\nSource: ${item.marker}`
      ),
      `# Compare the readings\n${comparisons || 'Where do the authors agree or disagree?'}\n\nSupport your answer with passages from two readings.`,
      '# Exit ticket\nExplain one central claim. What question remains?',
      `# Sources\n${references}`
    ].join('\n\n---\n\n')
  }
}

export function slidesHtml(lesson: Lesson): string {
  const escape = (text: string): string =>
    text.replace(
      /[&<>"']/g,
      (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
    )
  const slides = parseTeachingSlides(lesson.slides)
    .map(
      (slide) =>
        `<section>${`# ${slide.title}\n${slide.body}`
          .split('\n')
          .map((line) =>
            line.startsWith('# ') ? `<h1>${escape(line.slice(2))}</h1>` : `<p>${escape(line)}</p>`
          )
          .join('')}</section>`
    )
    .join('')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(lesson.title)}</title><style>body{margin:0;background:#eef0ed;color:#183e38;font:24px/1.5 system-ui}section{box-sizing:border-box;min-height:100vh;padding:6vw;break-after:page;border-bottom:1px solid #aaa}h1{font-size:2em;line-height:1.15}p{white-space:pre-wrap;overflow-wrap:anywhere}@media print{section{min-height:0;page-break-after:always}body{font-size:18pt;background:white}}</style>${slides}</html>`
}
