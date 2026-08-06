import type { Editor } from '@tiptap/react'
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Code,
  SquareCode,
  Table as TableIcon,
  type LucideIcon,
} from 'lucide-react'

export interface FormatAction {
  name: string
  label: string
  Icon: LucideIcon
  run: (editor: Editor) => void
  isActive: (editor: Editor) => boolean
}

export const formatActions: FormatAction[] = [
  {
    name: 'bold',
    label: 'Bold',
    Icon: Bold,
    run: (e) => e.chain().focus().toggleBold().run(),
    isActive: (e) => e.isActive('bold'),
  },
  {
    name: 'italic',
    label: 'Italic',
    Icon: Italic,
    run: (e) => e.chain().focus().toggleItalic().run(),
    isActive: (e) => e.isActive('italic'),
  },
  {
    name: 'strike',
    label: 'Strikethrough',
    Icon: Strikethrough,
    run: (e) => e.chain().focus().toggleStrike().run(),
    isActive: (e) => e.isActive('strike'),
  },
  {
    name: 'code',
    label: 'Inline code',
    Icon: Code,
    run: (e) => e.chain().focus().toggleCode().run(),
    isActive: (e) => e.isActive('code'),
  },
]

export const headingActions: FormatAction[] = [
  {
    name: 'h1',
    label: 'Heading 1',
    Icon: Heading1,
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    isActive: (e) => e.isActive('heading', { level: 1 }),
  },
  {
    name: 'h2',
    label: 'Heading 2',
    Icon: Heading2,
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    isActive: (e) => e.isActive('heading', { level: 2 }),
  },
  {
    name: 'h3',
    label: 'Heading 3',
    Icon: Heading3,
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    isActive: (e) => e.isActive('heading', { level: 3 }),
  },
]

export const listActions: FormatAction[] = [
  {
    name: 'bulletList',
    label: 'Bulleted list',
    Icon: List,
    run: (e) => e.chain().focus().toggleBulletList().run(),
    isActive: (e) => e.isActive('bulletList'),
  },
  {
    name: 'orderedList',
    label: 'Numbered list',
    Icon: ListOrdered,
    run: (e) => e.chain().focus().toggleOrderedList().run(),
    isActive: (e) => e.isActive('orderedList'),
  },
  {
    name: 'taskList',
    label: 'Checklist',
    Icon: ListChecks,
    run: (e) => e.chain().focus().toggleTaskList().run(),
    isActive: (e) => e.isActive('taskList'),
  },
  {
    name: 'blockquote',
    label: 'Quote',
    Icon: Quote,
    run: (e) => e.chain().focus().toggleBlockquote().run(),
    isActive: (e) => e.isActive('blockquote'),
  },
]

/**
 * Blocks with no markdown shorthand to type.
 *
 * A checklist has `[] `, a heading has `# ` — a table has nothing, so without a
 * control there is no way to reach one at all.
 */
export const blockActions: FormatAction[] = [
  {
    name: 'codeBlock',
    label: 'Code block',
    Icon: SquareCode,
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
    isActive: (e) => e.isActive('codeBlock'),
  },
  {
    name: 'table',
    label: 'Insert table',
    Icon: TableIcon,
    run: (e) =>
      e
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
    isActive: (e) => e.isActive('table'),
  },
]
