import type { JSONContent } from '@tiptap/core'

export function getDocumentText(content: JSONContent): string {
  if (content.type === 'wikiLink') return typeof content.attrs?.label === 'string' ? content.attrs.label : ''
  if (content.text) return content.text
  const separator = ['doc', 'taskList', 'bulletList', 'orderedList', 'listItem', 'taskItem'].includes(content.type ?? '') ? ' ' : ''
  return (content.content ?? []).map(getDocumentText).join(separator)
}

export function collectWikiLinks(content: JSONContent) {
  const links: Array<{ pageId: string; blockText: string }> = []

  const visit = (node: JSONContent, blockText = '') => {
    const text = node.type === 'paragraph' || node.type === 'heading' || node.type === 'taskItem' || node.type === 'codeBlock'
      ? getDocumentText(node)
      : blockText
    if (node.type === 'wikiLink' && typeof node.attrs?.pageId === 'string') {
      links.push({ pageId: node.attrs.pageId, blockText: text.trim() })
    }
    node.content?.forEach((child) => visit(child, text))
  }

  visit(content)
  return links
}

export function createBacklinkRecords(sourcePageId: string, content: JSONContent) {
  return collectWikiLinks(content).map((link, index) => ({
    id: `${sourcePageId}:${link.pageId}:${index}`,
    targetPageId: link.pageId,
    sourcePageId,
    blockText: link.blockText,
  }))
}

export function makeSearchSnippet(title: string, body: string, query: string, contextLength = 54) {
  const terms = query.trim().split(/\s+/).filter(Boolean)
  const haystack = `${title} ${body}`
  const lower = haystack.toLocaleLowerCase()
  const firstMatch = terms.map((term) => lower.indexOf(term.toLocaleLowerCase())).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, firstMatch - contextLength)
  const end = Math.min(haystack.length, firstMatch + contextLength * 2)
  return {
    text: `${start ? '…' : ''}${haystack.slice(start, end).trim()}${end < haystack.length ? '…' : ''}`,
    terms,
  }
}
