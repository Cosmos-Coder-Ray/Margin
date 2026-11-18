import { create } from 'zustand'
import { db, initializeDatabase, type Notebook, type NotePage } from './db'

interface AppState {
  notebooks: Notebook[]
  pages: NotePage[]
  selectedPageId: string | null
  loading: boolean
  theme: 'light' | 'dark'
  load: () => Promise<void>
  selectPage: (id: string) => void
  createPage: (notebookId?: string, parentId?: string | null) => Promise<string>
  updatePage: (id: string, changes: Partial<Pick<NotePage, 'title' | 'content'>>) => Promise<void>
  toggleTheme: () => void
}

const storedTheme = window.localStorage.getItem('margin-theme')

export const useAppStore = create<AppState>((set, get) => ({
  notebooks: [],
  pages: [],
  selectedPageId: null,
  loading: true,
  theme: storedTheme === 'dark' ? 'dark' : 'light',
  load: async () => {
    await initializeDatabase()
    const [notebooks, pages, contents] = await Promise.all([
      db.notebooks.orderBy('order').toArray(),
      db.pages.orderBy('order').toArray(),
      db.pageContents.toArray(),
    ])
    const contentsByPageId = new Map(contents.map((content) => [content.pageId, content.content]))
    const pageViews: NotePage[] = pages.map((page) => ({
      ...page,
      content: contentsByPageId.get(page.id) ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    }))
    const selectedPageId = get().selectedPageId ?? pageViews[0]?.id ?? null
    set({ notebooks, pages: pageViews, selectedPageId, loading: false })
  },
  selectPage: (id) => set({ selectedPageId: id }),
  createPage: async (notebookId, parentId = null) => {
    const notebook = notebookId ?? get().notebooks[0]?.id
    if (!notebook) throw new Error('Create a notebook before adding a page.')

    const now = Date.now()
    const id = crypto.randomUUID()
    const siblings = get().pages.filter((page) => page.notebookId === notebook && page.parentId === parentId)
    const page: NotePage = {
      id,
      notebookId: notebook,
      parentId,
      title: 'Untitled',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      order: siblings.length,
      createdAt: now,
      updatedAt: now,
    }
    const { content, ...record } = page
    await db.transaction('rw', db.pages, db.pageContents, async () => {
      await db.pages.add(record)
      await db.pageContents.add({ pageId: id, content, updatedAt: now })
    })
    set((state) => ({ pages: [...state.pages, page], selectedPageId: id }))
    return id
  },
  updatePage: async (id, changes) => {
    const updatedAt = Date.now()
    const { content, ...metadata } = changes
    await db.transaction('rw', db.pages, db.pageContents, async () => {
      await db.pages.update(id, { ...metadata, updatedAt })
      if (content) await db.pageContents.put({ pageId: id, content, updatedAt })
    })
    set((state) => ({
      pages: state.pages.map((page) => page.id === id ? { ...page, ...changes, updatedAt } : page),
    }))
  },
  toggleTheme: () => {
    const theme = get().theme === 'light' ? 'dark' : 'light'
    window.localStorage.setItem('margin-theme', theme)
    document.documentElement.dataset.theme = theme
    set({ theme })
  },
}))
