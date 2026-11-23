import { Markdown, MarkdownManager } from '@tiptap/markdown'
import { Extension, Node, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { db, type NotePage } from './db'
import { useAppStore } from './store'

const ImageBlock = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  addAttributes() {
    return { src: { default: null }, alt: { default: null }, title: { default: null } }
  },
  parseHTML() { return [{ tag: 'img[data-type="image"]' }] },
  renderHTML({ HTMLAttributes }) { return ['img', { 'data-type': 'image', ...HTMLAttributes }] },
  markdownTokenName: 'image',
  parseMarkdown: (token) => ({
    type: 'image', attrs: { src: token.href, alt: token.text, title: token.title },
  }),
  renderMarkdown: (node) => `![${node.attrs?.alt ?? ''}](${node.attrs?.src ?? ''}${node.attrs?.title ? ` "${node.attrs.title}"` : ''})`,
})

const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { pageId: { default: null }, label: { default: '' } }
  },
  parseHTML() { return [{ tag: 'span[data-wiki-page]' }] },
  renderHTML({ node }) { return ['span', { 'data-wiki-page': node.attrs.pageId }, node.attrs.label] },
  renderMarkdown: (node) => node.attrs?.label ?? '',
})

const markdownExtensions = [
  StarterKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  ImageBlock,
  WikiLink,
  Markdown,
  Extension.create({ name: 'callout' }),
]

const manager = new MarkdownManager({ extensions: markdownExtensions })

export function serializeMarkdown(content: JSONContent, title?: string) {
  const body = manager.serialize(content).trim()
  return [title ? `# ${title}` : '', body].filter(Boolean).join('\n\n') + '\n'
}

export function parseMarkdown(markdown: string) {
  const content = manager.parse(markdown)
  const first = content.content?.[0]
  const title = first?.type === 'heading' && first.attrs?.level === 1
    ? first.content?.map((node) => node.text ?? '').join('')
    : undefined
  if (title) content.content = content.content?.slice(1)
  return { title, content }
}

function mapContent(node: JSONContent, map: (node: JSONContent) => JSONContent): JSONContent {
  const next = { ...node, attrs: node.attrs ? { ...node.attrs } : undefined }
  if (node.content) next.content = node.content.map((child) => mapContent(child, map))
  return map(next)
}

function imageBytes(src: string) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(src)
  if (!match) return null
  const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0))
  const extension = match[1].split('/')[1].replace('jpeg', 'jpg')
  return { bytes, extension, mime: match[1] }
}

function dataUrl(bytes: Uint8Array, mime: string) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return `data:${mime};base64,${btoa(binary)}`
}

export async function exportPageMarkdown(page: NotePage) {
  return serializeMarkdown(page.content, page.title)
}

export async function exportNotebookMarkdown(notebookId: string) {
  const [notebook, pages] = await Promise.all([
    db.notebooks.get(notebookId),
    db.pages.where('notebookId').equals(notebookId).toArray(),
  ])
  if (!notebook) throw new Error('Notebook not found.')
  const pageStates = await db.pageState.bulkGet(pages.map((page) => page.id))
  const activePages = pages.filter((_, index) => !pageStates[index]?.deletedAt)
  const contents = await db.pageContents.bulkGet(activePages.map((page) => page.id))
  const files: Record<string, Uint8Array> = {}
  const slug = (value: string) => value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-') || 'Untitled'

  activePages.forEach((page, index) => {
    const content = contents[index]?.content ?? { type: 'doc', content: [] }
    const prepared = mapContent(content, (node) => {
      if (node.type !== 'image' || typeof node.attrs?.src !== 'string') return node
      const image = imageBytes(node.attrs.src)
      if (!image) return node
      const path = `assets/${slug(page.id)}-${files.length}.${image.extension}`
      files[path] = image.bytes
      return { ...node, attrs: { ...node.attrs, src: path } }
    })
    files[`${slug(page.title)}.md`] = strToU8(serializeMarkdown(prepared, page.title))
  })
  return new Blob([zipSync(files)], { type: 'application/zip' })
}

function normalizeZipPath(path: string) {
  const parts: string[] = []
  path.replaceAll('\\', '/').split('/').forEach((part) => {
    if (!part || part === '.') return
    if (part === '..') parts.pop()
    else parts.push(part)
  })
  return parts.join('/')
}

export async function importMarkdownFiles(files: File[], notebookId: string) {
  const pending: Array<{ title: string; content: JSONContent }> = []
  const localImages = new Map<string, string>()

  await Promise.all(files.filter((file) => file.type.startsWith('image/')).map(async (file) => {
    const path = normalizeZipPath(file.webkitRelativePath || file.name)
    localImages.set(path, dataUrl(new Uint8Array(await file.arrayBuffer()), file.type))
  }))

  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.zip')) {
      const archive = unzipSync(new Uint8Array(await file.arrayBuffer()))
      const markdownPaths = Object.keys(archive).filter((path) => path.toLowerCase().endsWith('.md'))
      for (const path of markdownPaths) {
        const parsed = parseMarkdown(strFromU8(archive[path]))
        const basePath = path.slice(0, path.lastIndexOf('/') + 1)
        const content = mapContent(parsed.content, (node) => {
          if (node.type !== 'image' || typeof node.attrs?.src !== 'string' || node.attrs.src.startsWith('data:')) return node
          const target = normalizeZipPath(`${basePath}${decodeURIComponent(node.attrs.src)}`)
          const image = archive[target]
          if (!image) return node
          const extension = target.split('.').pop()?.toLowerCase() ?? 'png'
          const mime = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`
          return { ...node, attrs: { ...node.attrs, src: dataUrl(image, mime) } }
        })
        pending.push({ title: parsed.title || path.split('/').pop()!.replace(/\.md$/i, ''), content })
      }
    } else if (file.name.toLowerCase().endsWith('.md')) {
      const parsed = parseMarkdown(await file.text())
      const markdownPath = normalizeZipPath(file.webkitRelativePath || file.name)
      const basePath = markdownPath.slice(0, markdownPath.lastIndexOf('/') + 1)
      const content = mapContent(parsed.content, (node) => {
        if (node.type !== 'image' || typeof node.attrs?.src !== 'string' || /^(?:data:|[a-z]+:|\/\/)/i.test(node.attrs.src)) return node
        const target = normalizeZipPath(`${basePath}${decodeURIComponent(node.attrs.src)}`)
        const image = localImages.get(target)
        if (!image) return node
        return { ...node, attrs: { ...node.attrs, src: image } }
      })
      pending.push({ title: parsed.title || file.name.replace(/\.md$/i, ''), content })
    }
  }

  const store = useAppStore.getState()
  for (const page of pending) {
    const id = await store.createPage(notebookId)
    await store.updatePage(id, { title: page.title, content: page.content })
  }
  return pending.length
}

export async function downloadMarkdown(filename: string, content: string | Blob) {
  const blob = typeof content === 'string' ? new Blob([content], { type: 'text/markdown;charset=utf-8' }) : content
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
