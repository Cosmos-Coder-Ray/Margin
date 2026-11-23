import 'fake-indexeddb/auto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, getBacklinks, indexBacklinks } from './db'

describe('backlink index', () => {
  beforeAll(async () => {
    await db.open()
  })

  afterAll(async () => {
    await db.delete()
  })

  it('replaces source links on each save', async () => {
    await indexBacklinks('source-page', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'See ' },
        { type: 'wikiLink', attrs: { pageId: 'target-page', label: 'the target' } },
        { type: 'text', text: ' next.' },
      ] }],
    })
    expect(await getBacklinks('target-page')).toEqual([{
      id: 'source-page:target-page:0',
      targetPageId: 'target-page',
      sourcePageId: 'source-page',
      blockText: 'See the target next.',
    }])

    await indexBacklinks('source-page', { type: 'doc', content: [{ type: 'paragraph' }] })
    expect(await getBacklinks('target-page')).toEqual([])
  })
})
