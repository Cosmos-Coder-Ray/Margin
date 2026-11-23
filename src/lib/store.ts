import { create } from 'zustand'
import { db, getPageState, indexBacklinks, initializeDatabase, type Notebook, type NotePage, type PageState, type PageTemplate } from './db'
import { createSearchDocument, pageSearch } from './search'

interface AppState {
  notebooks: Notebook[]
  pages: NotePage[]
  trash: NotePage[]
  pageStates: PageState[]
  templates: PageTemplate[]
  selectedPageId: string | null
  loading: boolean
  theme: 'light' | 'dark'
  load: () => Promise<void>
  selectPage: (id: string) => void
  createPage: (notebookId?: string, parentId?: string | null, select?: boolean) => Promise<string>
  updatePage: (id: string, changes: Partial<Pick<NotePage, 'title' | 'content'>>) => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  trashPage: (id: string) => Promise<void>
  restorePage: (id: string) => Promise<void>
  createTemplate: (name: string, content: NotePage['content']) => Promise<void>
  createPageFromTemplate: (templateId: string) => Promise<string>
  toggleTheme: () => void
}

const storedTheme = window.localStorage.getItem('margin-theme')

export const useAppStore = create<AppState>((set, get) => ({
  notebooks: [],
  pages: [],
  trash: [],
  pageStates: [],
  templates: [],
  selectedPageId: null,
  loading: true,
  theme: storedTheme === 'dark' ? 'dark' : 'light',
  load: async () => {
    await initializeDatabase()
    const expired = (await db.pageState.where('deletedAt').above(0).toArray())
      .filter((state) => Date.now() - state.deletedAt! > 30 * 24 * 60 * 60 * 1000)
    if (expired.length) {
      const ids = expired.map((state) => state.pageId)
      await db.transaction('rw', db.pages, db.pageContents, db.pageState, db.backlinks, async () => {
        await db.pages.bulkDelete(ids)
        await db.pageContents.bulkDelete(ids)
        await db.pageState.bulkDelete(ids)
        await db.backlinks.where('sourcePageId').anyOf(ids).delete()
        await db.backlinks.where('targetPageId').anyOf(ids).delete()
      })
    }
    const [notebooks, pages, contents, pageStates, templates] = await Promise.all([
      db.notebooks.orderBy('order').toArray(),
      db.pages.orderBy('order').toArray(),
      db.pageContents.toArray(),
      db.pageState.toArray(),
      db.templates.orderBy('createdAt').toArray(),
    ])
    const contentsByPageId = new Map(contents.map((content) => [content.pageId, content.content]))
    const pageViews: NotePage[] = pages.map((page) => ({
      ...page,
      content: contentsByPageId.get(page.id) ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    }))
    const selectedPageId = get().selectedPageId ?? pageViews[0]?.id ?? null
    const stateByPageId = new Map(pageStates.map((state) => [state.pageId, state]))
    const activePageViews = pageViews.filter((page) => !stateByPageId.get(page.id)?.deletedAt)
    await Promise.all(activePageViews.map((page) => indexBacklinks(page.id, page.content)))
    await Promise.all(pageViews.filter((page) => !activePageViews.some((active) => active.id === page.id)).map((page) => db.backlinks.where('sourcePageId').equals(page.id).delete()))
    await pageSearch.initialize(activePageViews.map((page) => createSearchDocument(page.id, page.title, page.content)))
    const trash = pageViews.filter((page) => Boolean(stateByPageId.get(page.id)?.deletedAt))
    set({ notebooks, pages: activePageViews, trash, pageStates, templates, selectedPageId: activePageViews.some((page) => page.id === selectedPageId) ? selectedPageId : activePageViews[0]?.id ?? null, loading: false })
  },
  selectPage: (id) => {
    set({ selectedPageId: id })
    void getPageState(id).then((current) => {
      const next = { pageId: id, favorite: current?.favorite ?? false, deletedAt: null, lastOpenedAt: Date.now() }
      return db.pageState.put(next).then(() => set((state) => ({ pageStates: [...state.pageStates.filter((item) => item.pageId !== id), next] })))
    })
  },
  createPage: async (notebookId, parentId = null, select = true) => {
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
    await db.pageState.put({ pageId: id, favorite: false, deletedAt: null, lastOpenedAt: now })
    pageSearch.upsert(createSearchDocument(id, page.title, page.content))
    set((state) => ({ pages: [...state.pages, page], selectedPageId: select ? id : state.selectedPageId }))
    return id
  },
  updatePage: async (id, changes) => {
    const updatedAt = Date.now()
    const { content, ...metadata } = changes
    await db.transaction('rw', db.pages, db.pageContents, async () => {
      await db.pages.update(id, { ...metadata, updatedAt })
      if (content) await db.pageContents.put({ pageId: id, content, updatedAt })
    })
    if (content) await indexBacklinks(id, content)
    const page = get().pages.find((item) => item.id === id)
    if (page) pageSearch.upsert(createSearchDocument(id, changes.title ?? page.title, content ?? page.content))
    set((state) => ({
      pages: state.pages.map((page) => page.id === id ? { ...page, ...changes, updatedAt } : page),
    }))
  },
  toggleFavorite: async (id) => {
    const current = await getPageState(id)
    const next = { pageId: id, favorite: !current?.favorite, deletedAt: current?.deletedAt ?? null, lastOpenedAt: current?.lastOpenedAt ?? Date.now() }
    await db.pageState.put(next)
    set((state) => ({ pageStates: [...state.pageStates.filter((item) => item.pageId !== id), next] }))
  },
  trashPage: async (id) => {
    const current = await getPageState(id)
    const next = { pageId: id, favorite: current?.favorite ?? false, deletedAt: Date.now(), lastOpenedAt: current?.lastOpenedAt ?? 0 }
    await db.pageState.put(next)
    await db.backlinks.where('sourcePageId').equals(id).delete()
    pageSearch.remove(id)
    set((state) => ({
      pages: state.pages.filter((page) => page.id !== id),
      trash: [...state.trash, state.pages.find((page) => page.id === id)].filter((page): page is NotePage => Boolean(page)),
      pageStates: [...state.pageStates.filter((item) => item.pageId !== id), next],
      selectedPageId: state.selectedPageId === id ? state.pages.find((page) => page.id !== id)?.id ?? null : state.selectedPageId,
    }))
  },
  restorePage: async (id) => {
    const current = await getPageState(id)
    if (!current || !current.deletedAt || Date.now() - current.deletedAt > 30 * 24 * 60 * 60 * 1000) return
    const next = { ...current, deletedAt: null }
    await db.pageState.put(next)
    const [record, content] = await Promise.all([db.pages.get(id), db.pageContents.get(id)])
    if (record && content) {
      await indexBacklinks(id, content.content)
      pageSearch.upsert(createSearchDocument(id, record.title, content.content))
      set((state) => ({ pages: [...state.pages, { ...record, content: content.content }], trash: state.trash.filter((page) => page.id !== id), pageStates: [...state.pageStates.filter((item) => item.pageId !== id), next] }))
    }
  },
  createTemplate: async (name, content) => {
    const template: PageTemplate = { id: crypto.randomUUID(), name, content, builtIn: false, createdAt: Date.now() }
    await db.templates.add(template)
    set((state) => ({ templates: [...state.templates, template] }))
  },
  createPageFromTemplate: async (templateId) => {
    const template = get().templates.find((item) => item.id === templateId)
    if (!template) throw new Error('Template not found.')
    const id = await get().createPage()
    await get().updatePage(id, { title: template.name, content: structuredClone(template.content) })
    return id
  },
  toggleTheme: () => {
    const theme = get().theme === 'light' ? 'dark' : 'light'
    window.localStorage.setItem('margin-theme', theme)
    document.documentElement.dataset.theme = theme
    set({ theme })
  },
}))
