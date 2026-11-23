import type { JSONContent } from '@tiptap/core'
import { getDocumentText } from './content'

export interface SearchDocument {
  id: string
  title: string
  body: string
}

export interface SearchResult extends SearchDocument {
  score: number
}

type WorkerResponse =
  | { type: 'ready' }
  | { type: 'results'; requestId: number; results: SearchResult[] }

class PageSearchIndex {
  private worker: Worker | null = null
  private requestId = 0
  private readyPromise: Promise<void> | null = null
  private pending = new Map<number, (results: SearchResult[]) => void>()

  initialize(documents: SearchDocument[]) {
    if (!this.worker) {
      this.worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' })
      this.readyPromise = new Promise((resolve) => {
        this.worker!.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
          if (event.data.type === 'ready') resolve()
          if (event.data.type === 'results') {
            this.pending.get(event.data.requestId)?.(event.data.results)
            this.pending.delete(event.data.requestId)
          }
        })
      })
    }
    this.worker.postMessage({ type: 'rebuild', documents })
    return this.readyPromise!
  }

  upsert(document: SearchDocument) {
    this.worker?.postMessage({ type: 'upsert', document })
  }

  remove(id: string) {
    this.worker?.postMessage({ type: 'remove', id })
  }

  async search(query: string) {
    await this.readyPromise
    if (!this.worker || !query.trim()) return []
    const requestId = ++this.requestId
    return new Promise<SearchResult[]>((resolve) => {
      this.pending.set(requestId, resolve)
      this.worker!.postMessage({ type: 'search', requestId, query })
    })
  }
}

export const pageSearch = new PageSearchIndex()

export function createSearchDocument(id: string, title: string, content: JSONContent): SearchDocument {
  return { id, title, body: getDocumentText(content) }
}
