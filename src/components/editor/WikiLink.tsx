import { Node, Extension } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { Suggestion, type SuggestionProps } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileText } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import type { NotePage } from '@/lib/db'
import { WikiLinkView } from './WikiLinkView'

export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { pageId: { default: null }, label: { default: '' } }
  },
  parseHTML() { return [{ tag: 'span[data-wiki-page]' }] },
  renderHTML({ node }) { return ['span', { 'data-wiki-page': node.attrs.pageId }, node.attrs.label] },
  addNodeView() { return ReactNodeViewRenderer(WikiLinkView) },
})

interface WikiLinkItem {
  label: string
  page?: NotePage
  create?: boolean
}

function insertLink(editor: SuggestionProps<WikiLinkItem>['editor'], pageId: string, label: string) {
  editor.chain().focus().insertContent({ type: 'wikiLink', attrs: { pageId, label } }).run()
}

export const WikiLinkSuggestion = Extension.create({
  name: 'wikiLinkSuggestion',
  addProseMirrorPlugins() {
    return [Suggestion<WikiLinkItem>({
      pluginKey: new PluginKey('wikiLinkSuggestion'),
      editor: this.editor,
      char: '[',
      allowSpaces: true,
      findSuggestionMatch: ({ $position }) => {
        const before = $position.nodeBefore?.textContent ?? ''
        const match = /\[\[([^\]]*)$/.exec(before)
        if (!match) return null
        const start = $position.pos - match[0].length
        return {
          range: { from: start + 1, to: $position.pos },
          query: match[1],
          text: match[0],
        }
      },
      items: ({ query }) => {
        const state = useAppStore.getState()
        const pages = state.pages.filter((page) => page.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
        if (!query || pages.length) return pages.slice(0, 8).map((page) => ({ label: page.title, page }))
        return [{ label: `Create “${query}”`, create: true }]
      },
      command: ({ editor, range, props }) => {
        editor.chain().focus().deleteRange({ from: range.from - 1, to: range.to }).run()
        if (props.page) {
          insertLink(editor, props.page.id, props.page.title)
          return
        }
        if (!props.create) return
        void (async () => {
          const store = useAppStore.getState()
          const sourcePage = store.pages.find((page) => page.id === store.selectedPageId)
          const title = props.label.replace(/^Create “|”$/g, '')
          const id = await store.createPage(sourcePage?.notebookId, sourcePage?.parentId ?? null, false)
          await useAppStore.getState().updatePage(id, { title })
          insertLink(editor, id, title)
        })()
      },
      render: () => {
        let root: HTMLDivElement | null = null
        let items: WikiLinkItem[] = []
        let activeIndex = 0
        let runItem: ((item: WikiLinkItem) => void) | undefined

        const paint = () => {
          if (!root) return
          root.replaceChildren()
          if (!items.length) {
            const empty = document.createElement('div')
            empty.className = 'wiki-link-empty'
            empty.textContent = 'Type a page title to create a link.'
            root.append(empty)
            return
          }
          items.forEach((item, index) => {
            const button = document.createElement('button')
            button.type = 'button'
            button.className = `wiki-link-option${index === activeIndex ? ' wiki-link-option-active' : ''}`
            button.setAttribute('role', 'option')
            button.setAttribute('aria-selected', String(index === activeIndex))
            const icon = document.createElement('span')
            icon.innerHTML = renderToStaticMarkup(<FileText className="icon-size" aria-hidden="true" />)
            button.append(icon.firstElementChild as SVGElement, document.createTextNode(item.label))
            button.addEventListener('mousedown', (event) => event.preventDefault())
            button.addEventListener('click', () => runItem?.(item))
            root?.append(button)
          })
        }

        const position = (rect?: DOMRect | null) => {
          if (!root || !rect) return
          root.style.left = `${Math.max(cssNumber('--space-3'), rect.left)}px`
          root.style.top = `${rect.bottom + cssNumber('--space-2')}px`
        }

        const update = (props: SuggestionProps<WikiLinkItem>) => {
          items = props.items
          activeIndex = Math.min(activeIndex, Math.max(items.length - 1, 0))
          runItem = (item) => { void props.command(item) }
          position(props.clientRect?.())
          paint()
        }

        return {
          onStart: (props) => {
            root = document.createElement('div')
            root.className = 'wiki-link-menu'
            root.setAttribute('role', 'listbox')
            root.setAttribute('aria-label', 'Link to a page')
            document.body.append(root)
            update(props)
          },
          onUpdate: update,
          onKeyDown: ({ event }) => {
            if (event.key === 'ArrowDown') {
              activeIndex = (activeIndex + 1) % Math.max(items.length, 1)
              paint()
              return true
            }
            if (event.key === 'ArrowUp') {
              activeIndex = (activeIndex - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1)
              paint()
              return true
            }
            if (event.key === 'Enter' && items[activeIndex]) {
              runItem?.(items[activeIndex])
              return true
            }
            return false
          },
          onExit: () => {
            root?.remove()
            root = null
          },
        }
      },
    })]
  },
})

function cssNumber(token: string) {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token))
}
