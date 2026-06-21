import type { Editor } from '@tiptap/react'
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
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
    name: 'blockquote',
    label: 'Quote',
    Icon: Quote,
    run: (e) => e.chain().focus().toggleBlockquote().run(),
    isActive: (e) => e.isActive('blockquote'),
  },
]
