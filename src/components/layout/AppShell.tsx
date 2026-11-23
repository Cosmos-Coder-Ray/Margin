import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  ArchiveRestore, BookOpen, Check, ChevronRight, CircleHelp, Clock3, Command, FileDown, FilePlus2, FileText, FileUp, Folder,
  Heart, Inbox, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen,
  PenLine, Plus, Search, Settings2, Star, Sun, Trash2,
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { Badge, Kbd, Menu, MenuItem, MenuSeparator, Tooltip } from '@/components/ui/Primitives'
import { Button } from '@/components/ui/Button'
import { SidebarItem } from '@/components/ui/SidebarItem'
import { pageSearch } from '@/lib/search'
import { makeSearchSnippet } from '@/lib/content'
import { downloadMarkdown, exportNotebookMarkdown, exportPageMarkdown, importMarkdownFiles } from '@/lib/markdown'

const NoteEditor = lazy(async () => {
  const module = await import('@/components/editor/NoteEditor')
  return { default: module.NoteEditor }
})

function cssNumber(token: string) {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token))
}

interface CommandItem {
  id: string
  label: string
  detail: string
  icon: typeof FileText
  kind: 'page' | 'action'
  snippet?: string
  run: () => void | Promise<void>
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter(Boolean).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!terms.length) return text
  const pattern = new RegExp(`(${terms.join('|')})`, 'ig')
  return text.split(pattern).map((part, index) => terms.some((term) => part.toLocaleLowerCase() === term.toLocaleLowerCase())
    ? <mark className="search-highlight" key={index}>{part}</mark>
    : part)
}

function fuzzyScore(query: string, value: string) {
  const normalizedQuery = query.toLowerCase().trim()
  const normalizedValue = value.toLowerCase()
  if (!normalizedQuery) return 0
  if (normalizedValue.includes(normalizedQuery)) return normalizedValue.indexOf(normalizedQuery)

  let queryIndex = 0
  let firstMatch = -1
  let previousMatch = -2
  let gaps = 0
  for (let index = 0; index < normalizedValue.length && queryIndex < normalizedQuery.length; index += 1) {
    if (normalizedValue[index] === normalizedQuery[queryIndex]) {
      if (firstMatch < 0) firstMatch = index
      if (previousMatch >= 0 && index !== previousMatch + 1) gaps += index - previousMatch - 1
      previousMatch = index
      queryIndex += 1
    }
  }
  return queryIndex === normalizedQuery.length ? 20 + firstMatch + gaps : Number.POSITIVE_INFINITY
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [searchState, setSearchState] = useState<{ query: string; results: Array<{ id: string; title: string; body: string; score: number }> } | null>(null)
  const pages = useAppStore((state) => state.pages)
  const selectedPageId = useAppStore((state) => state.selectedPageId)
  const createPage = useAppStore((state) => state.createPage)
  const selectPage = useAppStore((state) => state.selectPage)
  const toggleTheme = useAppStore((state) => state.toggleTheme)
  const notebooks = useAppStore((state) => state.notebooks)

  useEffect(() => {
    if (!query.trim()) return
    let active = true
    void pageSearch.search(query).then((results) => {
      if (active) setSearchState({ query, results })
    })
    return () => { active = false }
  }, [query])

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => inputRef.current?.focus(), 20)
    return () => clearTimeout(timer)
  }, [open])

  const items = useMemo<CommandItem[]>(() => {
    const pageItems: CommandItem[] = pages.map((page) => ({
      id: `page:${page.id}`,
      label: page.title,
      detail: notebooks.find((notebook) => notebook.id === page.notebookId)?.name ?? '',
      icon: FileText,
      kind: 'page',
      run: () => selectPage(page.id),
    }))
    const actionItems: CommandItem[] = [
      {
        id: 'create-page', label: 'Create a new page', detail: 'Product', icon: FilePlus2, kind: 'action',
        run: async () => { await createPage(notebooks[0]?.id) },
      },
      {
        id: 'toggle-theme', label: 'Toggle theme', detail: 'Appearance', icon: Sun, kind: 'action',
        run: toggleTheme,
      },
    ]
    return [...pageItems, ...actionItems]
  }, [createPage, notebooks, pages, selectPage, toggleTheme])

  const filteredItems = useMemo(() => {
    const pageItems: CommandItem[] = query.trim()
      ? (searchState?.query === query ? searchState.results : []).map((result) => {
        const page = pages.find((item) => item.id === result.id)
        return {
          id: `page:${result.id}`,
          label: result.title,
          detail: notebooks.find((notebook) => notebook.id === page?.notebookId)?.name ?? '',
          icon: FileText,
          kind: 'page',
          snippet: makeSearchSnippet(result.title, result.body, query).text,
          run: () => selectPage(result.id),
        }
      })
      : items.filter((item) => item.kind === 'page')
    const actionItems = items.filter((item) => item.kind === 'action')
      .map((item) => ({ item, score: fuzzyScore(query, `${item.label} ${item.detail}`) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score)
      .map((entry) => entry.item)
    return [...pageItems, ...actionItems]
  }, [items, notebooks, pages, query, searchState, selectPage])
  const searching = Boolean(query.trim() && searchState?.query !== query)

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setQuery('')
      setActiveIndex(0)
    }
    onOpenChange(nextOpen)
  }

  const runItem = async (item?: CommandItem) => {
    if (!item) return
    await item.run()
    handleOpenChange(false)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % Math.max(filteredItems.length, 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (current - 1 + Math.max(filteredItems.length, 1)) % Math.max(filteredItems.length, 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void runItem(filteredItems[activeIndex])
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="command-dialog-overlay" />
        <Dialog.Content className="command-dialog" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">Search notes and commands</Dialog.Title>
          <div className="command-search">
            <Search className="icon-size" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              aria-label="Search notes and commands"
              placeholder="Search notes and commands..."
              onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }}
              onKeyDown={onKeyDown}
            />
            <Kbd>esc</Kbd>
          </div>
          {searching ? <div className="command-empty" role="status">Searching notes…</div> : filteredItems.length ? (
            <>
              <div className="command-group-label">{query ? 'Results' : 'Quick actions'}</div>
              <div className="command-list" role="listbox" aria-label="Search results">
                {filteredItems.slice(0, 8).map((item, index) => {
                  const Icon = item.icon
                  const selected = item.kind === 'page' && item.id === `page:${selectedPageId}`
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      className={`command-row${index === activeIndex ? ' command-row-active' : ''}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => void runItem(item)}
                    >
                      <Icon aria-hidden="true" />
                      <span className="command-row-copy">
                        <span className="command-row-label"><HighlightText text={item.label} query={query} /></span>
                        {item.snippet && <span className="command-row-snippet"><HighlightText text={item.snippet} query={query} /></span>}
                      </span>
                      {selected ? <Check className="icon-size-small" aria-label="Current page" /> : <span className="text-tertiary">{item.detail}</span>}
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            <div className="command-empty">No notes or commands found.</div>
          )}
          <div className="command-footer">
            <span className="command-hint"><Kbd>↑</Kbd><Kbd>↓</Kbd> to navigate</span>
            <span className="command-hint"><Kbd>↵</Kbd> to open</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function AppShell() {
  const notebooks = useAppStore((state) => state.notebooks)
  const pages = useAppStore((state) => state.pages)
  const templates = useAppStore((state) => state.templates)
  const pageStates = useAppStore((state) => state.pageStates)
  const trash = useAppStore((state) => state.trash)
  const selectedPageId = useAppStore((state) => state.selectedPageId)
  const loading = useAppStore((state) => state.loading)
  const theme = useAppStore((state) => state.theme)
  const load = useAppStore((state) => state.load)
  const selectPage = useAppStore((state) => state.selectPage)
  const createPage = useAppStore((state) => state.createPage)
  const toggleFavorite = useAppStore((state) => state.toggleFavorite)
  const trashPage = useAppStore((state) => state.trashPage)
  const createTemplate = useAppStore((state) => state.createTemplate)
  const createPageFromTemplate = useAppStore((state) => state.createPageFromTemplate)
  const toggleTheme = useAppStore((state) => state.toggleTheme)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [expandedNotebooks, setExpandedNotebooks] = useState(() => new Set(['product']))
  const [expandedPages, setExpandedPages] = useState(() => new Set<string>())
  const [sidebarWidth, setSidebarWidth] = useState(() => cssNumber('--sidebar-width'))
  const [draggingSidebar, setDraggingSidebar] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)
  const selectedPage = pages.find((page) => page.id === selectedPageId)
  const activeNotebook = notebooks.find((notebook) => notebook.id === selectedPage?.notebookId)
  const selectedPageState = pageStates.find((state) => state.pageId === selectedPageId)
  const favoritePages = pages.filter((page) => pageStates.find((state) => state.pageId === page.id)?.favorite)
  const recentPages = [...pages].sort((a, b) => (pageStates.find((state) => state.pageId === b.id)?.lastOpenedAt ?? 0) - (pageStates.find((state) => state.pageId === a.id)?.lastOpenedAt ?? 0)).slice(0, 4)

  const toggleExpanded = (id: string, setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const renderNotebookPages = (notebookId: string, parentId: string | null, depth = 1): ReactNode => pages
    .filter((page) => page.notebookId === notebookId && page.parentId === parentId)
    .map((page) => {
      const hasChildren = pages.some((child) => child.parentId === page.id)
      const expanded = expandedPages.has(page.id)
      return (
        <Fragment key={page.id}>
          <SidebarItem
            icon={FileText}
            label={page.title}
            child
            depth={depth}
            selected={page.id === selectedPageId}
            expanded={hasChildren ? expanded : undefined}
            onClick={() => {
              selectPage(page.id)
              if (hasChildren) toggleExpanded(page.id, setExpandedPages)
            }}
          />
          {expanded && renderNotebookPages(notebookId, page.id, depth + 1)}
        </Fragment>
      )
    })

  const createSubpage = async () => {
    if (!selectedPage) return
    const pageId = await createPage(selectedPage.notebookId, selectedPage.id)
    setExpandedPages((current) => new Set(current).add(selectedPage.id))
    selectPage(pageId)
  }

  const importFiles = async (files: FileList | null) => {
    const notebookId = selectedPage?.notebookId ?? notebooks[0]?.id
    if (!files?.length || !notebookId) return
    await importMarkdownFiles(Array.from(files), notebookId)
    setTrashOpen(false)
  }

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!draggingSidebar) return
    const onMove = (event: MouseEvent) => setSidebarWidth(Math.min(cssNumber('--sidebar-width-max'), Math.max(cssNumber('--sidebar-width-min'), event.clientX)))
    const onUp = () => setDraggingSidebar(false)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
  }, [draggingSidebar])

  if (loading) return <main className="loading-screen" aria-label="Loading Margin" />

  const handleResizeKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = cssNumber('--space-4')
    if (event.key === 'ArrowLeft') setSidebarWidth((width) => Math.max(cssNumber('--sidebar-width-min'), width - step))
    if (event.key === 'ArrowRight') setSidebarWidth((width) => Math.min(cssNumber('--sidebar-width-max'), width + step))
  }

  return (
    <>
      <div className="app-shell">
        <aside
          className={`sidebar${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}
          style={{ '--sidebar-width': sidebarCollapsed ? 'var(--sidebar-collapsed-width)' : `${sidebarWidth}px` } as React.CSSProperties}
          aria-label="Main navigation"
        >
          <div className="sidebar-header">
            {!sidebarCollapsed && (
              <a className="brand" href="#home" aria-label="Margin home">
                <span className="brand-mark">m</span>
                <span className="brand-copy"><span className="brand-name">Margin</span><span className="brand-subtitle">Personal workspace</span></span>
              </a>
            )}
            <Tooltip content={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              <button
                type="button"
                className="icon-button"
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              >
                {sidebarCollapsed ? <PanelLeftOpen className="icon-size" /> : <PanelLeftClose className="icon-size" />}
              </button>
            </Tooltip>
          </div>
          <div className="sidebar-scroll">
            {!sidebarCollapsed && (
              <button className="sidebar-search" type="button" onClick={() => setPaletteOpen(true)}>
                <span className="sidebar-search-left"><Search className="icon-size" /><span className="sidebar-search-label">Search notes</span></span>
                <Kbd>⌘ K</Kbd>
              </button>
            )}
            <nav aria-label="Workspace">
              <SidebarItem icon={BookOpen} label="All notes" onClick={() => selectedPageId && selectPage(selectedPageId)} />
              <SidebarItem icon={Inbox} label="Inbox" />
              <SidebarItem icon={PenLine} label="Quick capture" onClick={() => void createPage()} />
            </nav>
            {!sidebarCollapsed && (
              <>
                <section className="sidebar-section" aria-label="Notebooks">
                  <div className="sidebar-section-heading">
                    <span>Notebooks</span>
                    <Tooltip content="Create a page">
                      <button className="sidebar-heading-action" type="button" aria-label="Create a page" onClick={() => void createPage()}><Plus className="icon-size" /></button>
                    </Tooltip>
                  </div>
                  {notebooks.map((notebook) => {
                    const hasPages = pages.some((page) => page.notebookId === notebook.id)
                    const expanded = expandedNotebooks.has(notebook.id)
                    return <div key={notebook.id}>
                      <SidebarItem
                        icon={Folder}
                        label={notebook.name}
                        expanded={hasPages ? expanded : undefined}
                        onClick={() => hasPages && toggleExpanded(notebook.id, setExpandedNotebooks)}
                      />
                      {expanded && renderNotebookPages(notebook.id, null)}
                    </div>
                  })}
                </section>
                <section className="sidebar-section" aria-label="Favorites">
                  <div className="sidebar-section-heading"><span>Favorites</span></div>
                  {favoritePages.length ? favoritePages.map((page) => (
                    <SidebarItem key={page.id} icon={Heart} label={page.title} selected={page.id === selectedPageId} onClick={() => { setTrashOpen(false); selectPage(page.id) }} />
                  )) : <div className="sidebar-section-empty">Pages you favorite will appear here.</div>}
                  <div className="sidebar-section-heading sidebar-recent-heading"><span>Recent pages</span><Clock3 className="icon-size-tiny" aria-hidden="true" /></div>
                  {recentPages.map((page) => <SidebarItem key={page.id} icon={FileText} label={page.title} selected={page.id === selectedPageId} onClick={() => { setTrashOpen(false); selectPage(page.id) }} />)}
                </section>
              </>
            )}
          </div>
          <div className="sidebar-footer">
            <SidebarItem icon={Trash2} label="Trash" selected={trashOpen} count={trash.length || undefined} onClick={() => setTrashOpen(true)} />
            <Menu label="Settings" trigger={<SidebarItem icon={Settings2} label="Settings" />}>
              <MenuItem onSelect={toggleTheme}>{theme === 'dark' ? <Sun /> : <Moon />}{theme === 'dark' ? 'Use light theme' : 'Use dark theme'}</MenuItem>
            </Menu>
          </div>
          {!sidebarCollapsed && (
            <div
              role="separator"
              aria-label="Resize sidebar"
              aria-orientation="vertical"
              aria-valuemin={cssNumber('--sidebar-width-min')}
              aria-valuemax={cssNumber('--sidebar-width-max')}
              aria-valuenow={sidebarWidth}
              tabIndex={0}
              className="sidebar-resize"
              onMouseDown={(event) => { event.preventDefault(); setDraggingSidebar(true) }}
              onKeyDown={handleResizeKey}
            />
          )}
        </aside>
        <main className="main-panel">
          <header className="topbar">
            <div className="breadcrumb" aria-label="Breadcrumb">
              <span>{activeNotebook?.name ?? 'Product'}</span>
              <ChevronRight className="icon-size-small" aria-hidden="true" />
              <span className="breadcrumb-current">{trashOpen ? 'Trash' : selectedPage?.title ?? 'All notes'}</span>
            </div>
            <div className="topbar-actions">
              <Badge tone="success"><Check className="icon-size-tiny" aria-hidden="true" />Saved</Badge>
              <Menu
                label="Page actions"
                trigger={<button type="button" className="icon-button" aria-label="Page actions"><MoreHorizontal className="icon-size" /></button>}
              >
                <MenuItem onSelect={() => void createPage()}><FilePlus2 />New page</MenuItem>
                {selectedPage && <MenuItem onSelect={() => void createSubpage()}><FileText />New subpage</MenuItem>}
                {templates.length > 0 && <>
                  <MenuSeparator />
                  <div className="menu-label">New from template</div>
                  {templates.map((template) => <MenuItem key={template.id} onSelect={() => void createPageFromTemplate(template.id)}><FileText />{template.name}</MenuItem>)}
                </>}
                {selectedPage && <MenuItem onSelect={() => void createTemplate(selectedPage.title, selectedPage.content)}><Star />Save page as template</MenuItem>}
                <MenuSeparator />
                <MenuItem onSelect={() => importInput.current?.click()}><FileUp />Import Markdown…</MenuItem>
                {selectedPage && <MenuItem onSelect={() => void exportPageMarkdown(selectedPage).then((markdown) => downloadMarkdown(`${selectedPage.title || 'Untitled'}.md`, markdown))}><FileDown />Export page as Markdown</MenuItem>}
                {activeNotebook && <MenuItem onSelect={() => void exportNotebookMarkdown(activeNotebook.id).then((archive) => downloadMarkdown(`${activeNotebook.name}.zip`, archive))}><FileDown />Export notebook as ZIP</MenuItem>}
                {selectedPage && <MenuItem onSelect={() => void toggleFavorite(selectedPage.id)}><Heart />{selectedPageState?.favorite ? 'Remove from favorites' : 'Add to favorites'}</MenuItem>}
                {selectedPage && <MenuItem onSelect={() => { void trashPage(selectedPage.id); setTrashOpen(true) }}><Trash2 />Move to trash</MenuItem>}
                <MenuItem onSelect={() => setPaletteOpen(true)}><Command />Open command palette <Kbd>⌘ K</Kbd></MenuItem>
                <MenuItem onSelect={toggleTheme}>{theme === 'dark' ? <Sun /> : <Moon />}{theme === 'dark' ? 'Use light theme' : 'Use dark theme'}</MenuItem>
                <MenuSeparator />
                <MenuItem><CircleHelp />Keyboard shortcuts</MenuItem>
              </Menu>
            </div>
          </header>
          <div className="editor-scroll">
            {trashOpen ? <TrashView /> : selectedPage ? <Suspense fallback={<div className="editor-loading" role="status">Opening note…</div>}><NoteEditor key={selectedPage.id} page={selectedPage} /></Suspense> : (
              <div className="empty-state">
                <Badge tone="neutral">Your notes are private</Badge>
                <h2>A page for every thought.</h2>
                <p>Start with a blank page. Your notes are saved locally as you write.</p>
                <Button variant="primary" onClick={() => void createPage()}><FilePlus2 />Create your first page</Button>
              </div>
            )}
          </div>
        </main>
      </div>
      <input ref={importInput} type="file" accept=".md,.zip,text/markdown,application/zip" multiple hidden onChange={(event) => { void importFiles(event.target.files); event.currentTarget.value = '' }} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  )
}

function TrashView() {
  const trash = useAppStore((state) => state.trash)
  const restorePage = useAppStore((state) => state.restorePage)

  return (
    <section className="trash-view" aria-labelledby="trash-title">
      <h1 id="trash-title">Trash</h1>
      <p>Pages are permanently removed after 30 days.</p>
      {trash.length ? <div className="trash-list">{trash.map((page) => (
        <div className="trash-row" key={page.id}>
          <div><span className="trash-page-title">{page.title}</span><span className="trash-page-notebook">{page.notebookId}</span></div>
          <Button variant="secondary" size="small" onClick={() => void restorePage(page.id)}><ArchiveRestore />Restore</Button>
        </div>
      ))}</div> : <div className="trash-empty">Trash is empty.</div>}
    </section>
  )
}
