import MiniSearch from 'minisearch'

interface SearchDocument {
  id: string
  title: string
  body: string
}

type SearchRequest =
  | { type: 'rebuild'; documents: SearchDocument[] }
  | { type: 'upsert'; document: SearchDocument }
  | { type: 'remove'; id: string }
  | { type: 'search'; requestId: number; query: string }

const index = new MiniSearch<SearchDocument>({
  fields: ['title', 'body'],
  storeFields: ['title', 'body'],
  searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 2 } },
})
const documents = new Map<string, SearchDocument>()
let queue = Promise.resolve()

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<SearchRequest>) => void) | null
  postMessage(message: unknown): void
}

worker.onmessage = (event: MessageEvent<SearchRequest>) => {
  queue = queue.then(async () => {
    const message = event.data
    if (message.type === 'rebuild') {
      index.removeAll()
      documents.clear()
      message.documents.forEach((document) => documents.set(document.id, document))
      await index.addAllAsync(message.documents, { chunkSize: 100 })
      worker.postMessage({ type: 'ready' })
      return
    }
    if (message.type === 'upsert') {
      const existing = documents.get(message.document.id)
      if (existing) index.replace(message.document)
      else index.add(message.document)
      documents.set(message.document.id, message.document)
      return
    }
    if (message.type === 'remove') {
      const existing = documents.get(message.id)
      if (existing) index.remove(existing)
      documents.delete(message.id)
      return
    }
    worker.postMessage({
      type: 'results',
      requestId: message.requestId,
      results: index.search(message.query).slice(0, 20).map((result) => ({
        id: result.id,
        title: result.title,
        body: result.body,
        score: result.score,
      })),
    })
  })
}
