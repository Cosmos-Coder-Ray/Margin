import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { collectWikiLinks, createBacklinkRecords } from './content'

describe('wiki links', () => {
  it('parses page IDs and surrounding block text for backlinks', () => {
    const content: JSONContent = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Read the follow-up in ' },
          { type: 'wikiLink', attrs: { pageId: 'page-2', label: 'Research notes' } },
          { type: 'text', text: ' before Friday.' },
        ],
      }],
    }

    expect(collectWikiLinks(content)).toEqual([
      { pageId: 'page-2', blockText: 'Read the follow-up in Research notes before Friday.' },
    ])
    expect(createBacklinkRecords('page-1', content)).toEqual([
      {
        id: 'page-1:page-2:0',
        targetPageId: 'page-2',
        sourcePageId: 'page-1',
        blockText: 'Read the follow-up in Research notes before Friday.',
      },
    ])
  })
})
