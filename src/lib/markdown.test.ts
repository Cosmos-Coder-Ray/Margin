import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { getDocumentText } from './content'
import { parseMarkdown, serializeMarkdown } from './markdown'

describe('Markdown round trips', () => {
  it('preserves headings, tasks, code, and images', () => {
    const original: JSONContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Review the notes' }] }] }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'const ready = true' }] },
        { type: 'image', attrs: { src: 'data:image/png;base64,aGVsbG8=', alt: 'sketch' } },
      ],
    }

    const markdown = serializeMarkdown(original, 'Research')
    const parsed = parseMarkdown(markdown)
    const types = parsed.content.content?.map((node) => node.type)

    expect(parsed.title).toBe('Research')
    expect(types).toEqual(['heading', 'taskList', 'codeBlock', 'image'])
    expect(getDocumentText(parsed.content)).toContain('Review the notes')
    expect(parsed.content.content?.[1].content?.[0].attrs?.checked).toBe(true)
    expect(parsed.content.content?.[3].attrs).toMatchObject({ src: 'data:image/png;base64,aGVsbG8=', alt: 'sketch' })
  })
})
