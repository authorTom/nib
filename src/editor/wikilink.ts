import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { WIKILINK_RE } from '../lib/wikilinks'

export interface WikilinkOptions {
  /** Note id for a target, or null when nothing in the vault matches. */
  resolve: (target: string) => string | null
  /** Called when the reader clicks a link that resolves. */
  onOpen: (noteId: string) => void
}

export const wikilinkPluginKey = new PluginKey('wikilink')

/**
 * Renders `[[Target]]` as a clickable link without touching the document.
 *
 * Wikilinks stay plain text in the model, so `tiptap-markdown` round-trips them
 * untouched and the `.md` on disk keeps the exact syntax Obsidian expects.
 * Everything here is presentation: inline decorations for the styling, and a
 * click handler for navigation.
 */
export const Wikilink = Extension.create<WikilinkOptions>({
  name: 'wikilink',

  addOptions() {
    return {
      resolve: () => null,
      onOpen: () => {},
    }
  },

  addProseMirrorPlugins() {
    const { resolve, onOpen } = this.options

    return [
      new Plugin({
        key: wikilinkPluginKey,
        props: {
          // Recomputed on every view update rather than cached in plugin state:
          // resolution depends on the note list, which changes independently of
          // the document, and a stale decoration would show a live link as broken.
          decorations(state) {
            const decorations: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              // Code spans are literal — a `[[x]]` inside one isn't a link.
              if (node.marks.some((m) => m.type.name === 'code')) return
              WIKILINK_RE.lastIndex = 0
              let m: RegExpExecArray | null
              while ((m = WIKILINK_RE.exec(node.text))) {
                const target = m[1].trim()
                const noteId = resolve(target)
                decorations.push(
                  Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
                    class: `wikilink${noteId ? '' : ' broken'}`,
                    'data-wikilink': target,
                    title: noteId
                      ? `Open ${target}`
                      : `${target} — no note with that name yet`,
                  }),
                )
              }
            })
            return DecorationSet.create(state.doc, decorations)
          },

          handleClick(_view, _pos, event) {
            const el = (event.target as HTMLElement | null)?.closest?.(
              '[data-wikilink]',
            )
            if (!el) return false
            // Alt-click falls through to normal cursor placement, so the link
            // text itself stays editable.
            if (event.altKey) return false
            const noteId = resolve(el.getAttribute('data-wikilink') ?? '')
            if (!noteId) return false
            event.preventDefault()
            onOpen(noteId)
            return true
          },
        },
      }),
    ]
  },
})
