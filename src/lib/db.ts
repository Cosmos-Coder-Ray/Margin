import Dexie, { type EntityTable } from 'dexie'
import type { JSONContent } from '@tiptap/core'

export interface Notebook {
  id: string
  name: string
  order: number
  createdAt: number
}

export interface NotePageRecord {
  id: string
  notebookId: string
  parentId: string | null
  title: string
  order: number
  createdAt: number
  updatedAt: number
}

export interface PageContent {
  pageId: string
  content: JSONContent
  updatedAt: number
}

export interface NotePage extends NotePageRecord {
  content: JSONContent
}

class MarginDatabase extends Dexie {
  notebooks!: EntityTable<Notebook, 'id'>
  pages!: EntityTable<NotePageRecord, 'id'>
  pageContents!: EntityTable<PageContent, 'pageId'>

  constructor() {
    super('margin')
    this.version(1).stores({
      notebooks: 'id, name, createdAt',
      pages: 'id, notebookId, parentId, order, updatedAt',
    })
    this.version(2).stores({
      notebooks: 'id, name, order, createdAt',
      pages: 'id, notebookId, parentId, order, updatedAt',
    }).upgrade(async (transaction) => {
      const notebooks = await transaction.table('notebooks').orderBy('createdAt').toArray() as Notebook[]
      for (const [index, notebook] of notebooks.entries()) {
        await transaction.table('notebooks').update(notebook.id, { order: index })
      }
    })
    this.version(3).stores({
      notebooks: 'id, name, order, createdAt',
      pages: 'id, notebookId, parentId, order, updatedAt',
      pageContents: 'pageId, updatedAt',
    }).upgrade(async (transaction) => {
      const pages = await transaction.table('pages').toArray() as Array<NotePageRecord & { content?: JSONContent }>
      for (const page of pages) {
        if (!page.content) continue
        const { content, ...record } = page
        await transaction.table('pages').put(record)
        await transaction.table('pageContents').put({ pageId: page.id, content, updatedAt: page.updatedAt })
      }
    })
  }
}

export const db = new MarginDatabase()

const welcomeContent: JSONContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'A quieter place for ideas that need a little room to become clear.' }] },
    { type: 'horizontalRule' },
    {
      type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Today' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Keep the next step small enough to begin. A good note should make the work feel lighter, not create another thing to manage.' }],
    },
    {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Choose one useful thing to finish before adding more.' }] }] },
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Leave a little space for the unexpected.' }] }] },
      ],
    },
  ],
}

export async function initializeDatabase() {
  await db.transaction('rw', db.notebooks, db.pages, db.pageContents, async () => {
    if (await db.notebooks.count()) return
    const now = Date.now()
    await db.notebooks.bulkAdd([
      { id: 'product', name: 'Product', order: 0, createdAt: now },
      { id: 'journal', name: 'Journal', order: 1, createdAt: now },
    ])
    await db.pages.add({
      id: 'q3-direction',
      notebookId: 'product',
      parentId: null,
      title: 'A note to return to',
      order: 0,
      createdAt: now,
      updatedAt: now,
    })
    await db.pageContents.add({ pageId: 'q3-direction', content: welcomeContent, updatedAt: now })
    await db.pages.add({
      id: 'research-notes',
      notebookId: 'product',
      parentId: null,
      title: 'Research notes',
      order: 1,
      createdAt: now,
      updatedAt: now,
    })
    await db.pageContents.add({
      pageId: 'research-notes',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      updatedAt: now,
    })
  })
}
