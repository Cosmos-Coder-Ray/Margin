import { useEffect, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BubbleMenu } from '@tiptap/react/menus'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Suggestion } from '@tiptap/suggestion'
import { Extension, Node, mergeAttributes } from '@tiptap/core'
import { Placeholder } from '@tiptap/extensions'
import { Bold, Code2, Heading2, Image, Italic, List, ListOrdered, ListTodo, MessageSquareQuote, Pilcrow, SeparatorHorizontal, Sparkles, Strikethrough, Check } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import type { NotePage } from '@/lib/db'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Primitives'
import { db, type Backlink } from '@/lib/db'
import { WikiLink, WikiLinkSuggestion } from './WikiLink'

interface SlashItem {
  title: string
  detail: string
  keywords: string
  icon: typeof Pilcrow
  run: (editor: Editor) => void
}

const slashItems: SlashItem[] = [
  { title: 'Text', detail: 'Plain paragraph', keywords: 'paragraph text', icon: Pilcrow, run: (editor) => editor.chain().focus().setParagraph().run() },
  { title: 'Heading', detail: 'Section heading', keywords: 'heading title h2', icon: Heading2, run: (editor) => editor.chain().focus().setNode('heading', { level: 2 }).run() },
  { title: 'Bulleted list', detail: 'Simple list', keywords: 'bullet unordered list', icon: List, run: (editor) => editor.chain().focus().toggleBulletList().run() },
  { title: 'Numbered list', detail: 'Ordered steps', keywords: 'number ordered list', icon: ListOrdered, run: (editor) => editor.chain().focus().toggleOrderedList().run() },
  { title: 'To-do list', detail: 'Track a few steps', keywords: 'todo task checklist', icon: ListTodo, run: (editor) => editor.chain().focus().toggleTaskList().run() },
  { title: 'Quote', detail: 'A note worth keeping', keywords: 'quote blockquote', icon: MessageSquareQuote, run: (editor) => editor.chain().focus().setBlockquote().run() },
  { title: 'Code block', detail: 'Formatted code', keywords: 'code snippet', icon: Code2, run: (editor) => editor.chain().focus().setCodeBlock().run() },
  { title: 'Divider', detail: 'Separate sections', keywords: 'divider horizontal rule', icon: SeparatorHorizontal, run: (editor) => editor.chain().focus().setHorizontalRule().run() },
  { title: 'Image', detail: 'Add an image from this device', keywords: 'image picture photo', icon: Image, run: addImage },
  {
    title: 'Callout', detail: 'A quiet highlight', keywords: 'callout note', icon: Sparkles,
    run: (editor) => editor.chain().focus().insertContent({ type: 'callout', content: [{ type: 'paragraph' }] }).run(),
  },
]

function addImage(editor: Editor) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.hidden = true
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) {
      input.remove()
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        editor.chain().focus().insertContent({ type: 'image', attrs: { src: reader.result, alt: file.name } }).run()
      }
      input.remove()
    }
    reader.onerror = () => input.remove()
    reader.readAsDataURL(file)
  }
  input.oncancel = () => input.remove()
  document.body.append(input)
  input.click()
}

function cssNumber(token: string) {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token))
}

const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML() { return [{ tag: 'aside[data-type="callout"]' }] },
  renderHTML() { return ['aside', { 'data-type': 'callout' }, 0] },
})

const ImageBlock = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
    }
  },
  parseHTML() { return [{ tag: 'img[data-type="image"]' }] },
  renderHTML({ HTMLAttributes }) { return ['img', mergeAttributes({ 'data-type': 'image' }, HTMLAttributes)] },
})

const SlashCommands = Extension.create({
  name: 'slashCommands',
  addProseMirrorPlugins() {
    return [Suggestion<SlashItem>({
      editor: this.editor,
      char: '/',
      startOfLine: true,
      items: ({ query }) => slashItems.filter((item) => `${item.title} ${item.keywords}`.toLowerCase().includes(query.toLowerCase())),
      command: ({ editor, range, props }) => {
        editor.chain().focus().deleteRange(range).run()
        props.run(editor)
      },
      render: () => {
        let root: HTMLDivElement | null = null
        let currentItems: SlashItem[] = []
        let activeIndex = 0
        let runItem: ((item: SlashItem) => void) | undefined

        const paint = () => {
          if (!root) return
          const menu = root
          menu.replaceChildren()
          currentItems.forEach((item, index) => {
            const row = document.createElement('button')
            row.type = 'button'
            row.className = `slash-menu-item${index === activeIndex ? ' slash-menu-item-active' : ''}`
            row.setAttribute('role', 'option')
            row.setAttribute('aria-selected', String(index === activeIndex))
            const Icon = item.icon
            const wrapper = document.createElement('span')
            wrapper.innerHTML = renderToStaticMarkup(<Icon className="icon-size" aria-hidden="true" />)
            row.append(wrapper.firstElementChild as SVGElement, document.createTextNode(item.title))
            row.addEventListener('mousedown', (event) => event.preventDefault())
            row.addEventListener('click', () => runItem?.(item))
            menu.append(row)
          })
        }

        const position = (rect?: DOMRect | null) => {
          if (!root || !rect) return
          root.style.left = `${Math.max(cssNumber('--space-3'), rect.left)}px`
          root.style.top = `${rect.bottom + cssNumber('--space-2')}px`
        }

        return {
          onStart: (props) => {
            root = document.createElement('div')
            root.className = 'slash-menu'
            root.setAttribute('role', 'listbox')
            document.body.append(root)
            currentItems = props.items
            activeIndex = 0
            runItem = (item) => props.command(item)
            position(props.clientRect?.())
            paint()
          },
          onUpdate: (props) => {
            currentItems = props.items
            activeIndex = Math.min(activeIndex, Math.max(props.items.length - 1, 0))
            runItem = (item) => props.command(item)
            position(props.clientRect?.())
            paint()
          },
          onKeyDown: ({ event }) => {
            if (event.key === 'ArrowDown') {
              activeIndex = (activeIndex + 1) % Math.max(currentItems.length, 1)
              paint()
              return true
            }
            if (event.key === 'ArrowUp') {
              activeIndex = (activeIndex - 1 + Math.max(currentItems.length, 1)) % Math.max(currentItems.length, 1)
              paint()
              return true
            }
            if (event.key === 'Enter' && currentItems[activeIndex]) {
              runItem?.(currentItems[activeIndex])
              return true
            }
            if (event.key === 'Escape') {
              return false
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

export function NoteEditor({ page }: { page: NotePage }) {
  const updatePage = useAppStore((state) => state.updatePage)
  const [title, setTitle] = useState(page.title)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(true)
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Callout,
      ImageBlock,
      SlashCommands,
      WikiLink,
      WikiLinkSuggestion,
      Placeholder.configure({ placeholder: 'Write something, or type / for blocks…' }),
    ],
    content: page.content,
    editorProps: { attributes: { class: 'tiptap', 'aria-label': 'Note content' } },
    onUpdate: ({ editor: current }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      setSaving(true)
      setSaved(false)
      saveTimer.current = setTimeout(async () => {
        await updatePage(page.id, { content: current.getJSON() })
        setSaving(false)
        setSaved(true)
      }, 450)
    },
  }, [page.id])

  useEffect(() => () => {
    if (titleTimer.current) clearTimeout(titleTimer.current)
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  const onTitleChange = (value: string) => {
    setTitle(value)
    if (titleTimer.current) clearTimeout(titleTimer.current)
    setSaving(true)
    setSaved(false)
    titleTimer.current = setTimeout(async () => {
      await updatePage(page.id, { title: value.trim() || 'Untitled' })
      setSaving(false)
      setSaved(true)
    }, 450)
  }

  return (
    <article className="editor-page">
      <div className="editor-meta">
        <div className="editor-meta-left">
          <span>Edited just now</span>
          <span aria-hidden="true">·</span>
          <span className="save-status" role="status" aria-live="polite">
            {saving ? 'Saving…' : saved && <><Check className="icon-size-tiny" aria-hidden="true" /> Saved locally</>}
          </span>
        </div>
        <Badge tone="neutral">Private</Badge>
      </div>
      <input
        className="page-title-input"
        aria-label="Page title"
        value={title}
        placeholder="Untitled"
        onChange={(event) => onTitleChange(event.target.value)}
      />
      <div className="editor-body">
        {editor && (
          <>
            <BubbleMenu editor={editor}>
              <div className="bubble-menu" role="toolbar" aria-label="Text formatting">
                <Button variant="icon" size="small" aria-label="Bold" onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></Button>
                <Button variant="icon" size="small" aria-label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></Button>
                <Button variant="icon" size="small" aria-label="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough /></Button>
              </div>
            </BubbleMenu>
            <EditorContent editor={editor} />
          </>
        )}
      </div>
      <LinkedReferences pageId={page.id} />
    </article>
  )
}

function LinkedReferences({ pageId }: { pageId: string }) {
  const pages = useAppStore((state) => state.pages)
  const selectPage = useAppStore((state) => state.selectPage)
  const [references, setReferences] = useState<Backlink[]>([])

  useEffect(() => {
    let active = true
    void db.backlinks.where('targetPageId').equals(pageId).toArray().then((items) => {
      if (active) setReferences(items)
    })
    return () => { active = false }
  }, [pageId, pages])

  return (
    <section className="linked-references" aria-labelledby="linked-references-title">
      <h2 id="linked-references-title">Linked references</h2>
      {references.length ? references.map((reference) => {
        const source = pages.find((item) => item.id === reference.sourcePageId)
        if (!source) return null
        return (
          <button key={reference.id} type="button" className="linked-reference" onClick={() => selectPage(source.id)}>
            <span className="linked-reference-title">{source.title}</span>
            <span className="linked-reference-text">{reference.blockText || 'Linked from this page'}</span>
          </button>
        )
      }) : <p className="linked-references-empty">No pages link here yet.</p>}
    </section>
  )
}
