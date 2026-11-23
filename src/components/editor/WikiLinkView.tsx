import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useAppStore } from '@/lib/store'

export function WikiLinkView({ node }: NodeViewProps) {
  const pages = useAppStore((state) => state.pages)
  const selectPage = useAppStore((state) => state.selectPage)
  const page = pages.find((item) => item.id === node.attrs.pageId)
  const label = page?.title ?? node.attrs.label ?? 'Missing page'

  return (
    <NodeViewWrapper as="span" className="wiki-link-node">
      <button type="button" className="wiki-link" onClick={() => page && selectPage(page.id)} disabled={!page}>
        {label}
      </button>
    </NodeViewWrapper>
  )
}
