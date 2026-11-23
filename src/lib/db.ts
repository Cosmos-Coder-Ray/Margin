import Dexie, { type EntityTable } from 'dexie'
import type { JSONContent } from '@tiptap/core'
import { createBacklinkRecords } from './content'

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

export interface PageState {
  pageId: string
  favorite: boolean
  deletedAt: number | null
  lastOpenedAt: number
}

export interface Backlink {
  id: string
  targetPageId: string
  sourcePageId: string
  blockText: string
}

export interface PageTemplate {
  id: string
  name: string
  content: JSONContent
  builtIn: boolean
  createdAt: number
}

export interface NotePage extends NotePageRecord {
  content: JSONContent
}

class MarginDatabase extends Dexie {
  notebooks!: EntityTable<Notebook, 'id'>
  pages!: EntityTable<NotePageRecord, 'id'>
  pageContents!: EntityTable<PageContent, 'pageId'>
  pageState!: EntityTable<PageState, 'pageId'>
  backlinks!: EntityTable<Backlink, 'id'>
  templates!: EntityTable<PageTemplate, 'id'>

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
    this.version(4).stores({
      notebooks: 'id, name, order, createdAt',
      pages: 'id, notebookId, parentId, order, updatedAt',
      pageContents: 'pageId, updatedAt',
      pageState: 'pageId, favorite, deletedAt, lastOpenedAt',
      backlinks: 'id, targetPageId, sourcePageId',
      templates: 'id, name, createdAt',
    })
  }
}

export const db = new MarginDatabase()

export function getPageState(pageId: string) {
  return db.pageState.get(pageId)
}

export function getBacklinks(pageId: string) {
  return db.backlinks.where('targetPageId').equals(pageId).toArray()
}

export async function indexBacklinks(sourcePageId: string, content: JSONContent) {
  const links: Backlink[] = createBacklinkRecords(sourcePageId, content)
  await db.transaction('rw', db.backlinks, async () => {
    await db.backlinks.where('sourcePageId').equals(sourcePageId).delete()
    if (links.length) await db.backlinks.bulkPut(links)
  })
}

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
  await db.transaction('rw', db.notebooks, db.pages, db.pageContents, db.pageState, db.templates, async () => {
    if (await db.notebooks.count()) {
      const missingTemplates = []
      for (const template of builtInTemplates) {
        if (!await db.templates.get(template.id)) missingTemplates.push({ ...template, createdAt: Date.now() })
      }
      if (missingTemplates.length) await db.templates.bulkAdd(missingTemplates)
      const pages = await db.pages.toArray()
      for (const page of pages) {
        if (!await db.pageState.get(page.id)) {
          await db.pageState.add({ pageId: page.id, favorite: false, deletedAt: null, lastOpenedAt: page.updatedAt })
        }
      }
      return
    }
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
    await db.pageState.bulkAdd([
      { pageId: 'q3-direction', favorite: false, deletedAt: null, lastOpenedAt: now },
      { pageId: 'research-notes', favorite: false, deletedAt: null, lastOpenedAt: now - 1 },
    ])
    await db.templates.bulkAdd(builtInTemplates.map((template) => ({ ...template, createdAt: now })))
  })
}

const builtInTemplates: Omit<PageTemplate, 'createdAt'>[] = [
  { id: 'template-meeting', name: 'Meeting notes', builtIn: true, content: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Meeting notes' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Date · Attendees' }] },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Agenda' }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] }] },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Notes' }] },
    { type: 'paragraph' },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Action items' }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] }] },
  ] } },
  { id: 'template-journal', name: 'Daily journal', builtIn: true, content: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Daily journal' }] },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Today I’m grateful for' }] },
    { type: 'paragraph' },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'What mattered today' }] },
    { type: 'paragraph' },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Tomorrow' }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] }] },
  ] } },
  { id: 'template-project', name: 'Project brief', builtIn: true, content: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Project brief' }] },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Purpose' }] }, { type: 'paragraph' },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Goals' }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] }] },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Scope and constraints' }] }, { type: 'paragraph' },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Next steps' }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] }] },
  ] } },
  { id: 'template-reading', name: 'Reading notes', builtIn: true, content: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Reading notes' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Title · Author · Date' }] },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Summary' }] }, { type: 'paragraph' },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Key ideas' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Questions' }] }, { type: 'paragraph' },
  ] } },
]
