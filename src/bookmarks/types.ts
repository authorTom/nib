export interface Bookmark {
  id: string
  url: string
  title: string
  /** Free-form comment — why it was saved, prices seen, thoughts. */
  comment: string
  /** Collection the bookmark belongs to; null = unfiled. */
  collectionId: string | null
  /** The note this bookmark was captured from, if any. */
  source?: { noteId: string }
  createdAt: number
}

export interface Collection {
  id: string
  name: string
  color: string
}

export interface BookmarkStore {
  version: 1
  bookmarks: Bookmark[]
  collections: Collection[]
}
