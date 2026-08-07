import * as library from '../fs/library'
import * as history from '../fs/history'
import { searchLibrary } from './retrieval'
import type { TreeNode } from '../fs/library'
import type { AssistantSettings, ToolCall, ToolDef } from './types'

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'list_files',
    description:
      'List every folder and Markdown note in the library as an indented tree. Use this first to understand the structure.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
  },
  {
    name: 'search_notes',
    description:
      'Search the library for notes relevant to a query — matches titles, paths, and content (plus semantic similarity when enabled). Returns the best-matching note paths with snippets; use read_file to read a result in full.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to look for — a question, topic, or keywords.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    readOnly: true,
  },
  {
    name: 'read_file',
    description: 'Read the full Markdown contents of a note.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Note path, e.g. "Projects/idea.md".' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    readOnly: true,
  },
  {
    name: 'write_file',
    description:
      'Create a new note or overwrite an existing one with the given Markdown content. Creates parent folders as needed.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Note path ending in .md' },
        content: { type: 'string', description: 'Full Markdown content of the note.' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: 'create_folder',
    description: 'Create a folder (and any missing parent folders) at the given path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Folder path, e.g. "Projects/2026".' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: 'move_file',
    description: 'Move or rename a note from one path to another.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Current note path.' },
        to: { type: 'string', description: 'New note path (ending in .md).' },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: 'delete_file',
    description: 'Move a note to the recycle bin (recoverable).',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Note path.' } },
      required: ['path'],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: 'delete_folder',
    description:
      'Move a folder and all of its notes to the recycle bin (recoverable).',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Folder path.' } },
      required: ['path'],
      additionalProperties: false,
    },
    readOnly: false,
  },
]

export function toolByName(name: string): ToolDef | undefined {
  return TOOL_DEFS.find((t) => t.name === name)
}

function renderTree(nodes: TreeNode[], depth = 0): string {
  return nodes
    .map((node) => {
      const indent = '  '.repeat(depth)
      if (node.kind === 'folder') {
        return `${indent}${node.name}/\n${renderTree(node.children, depth + 1)}`
      }
      return `${indent}${node.name}\n`
    })
    .join('')
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  if (typeof v !== 'string') throw new Error(`Missing or invalid "${key}"`)
  return v
}

/** Execute a tool against the library. Returns a text result for the model. */
export async function executeTool(
  dir: FileSystemDirectoryHandle,
  call: ToolCall,
  ctx?: { settings: AssistantSettings },
): Promise<string> {
  const a = call.arguments
  switch (call.name) {
    case 'list_files': {
      const tree = await library.buildTree(dir)
      return renderTree(tree).trim() || '(the library is empty)'
    }
    case 'search_notes': {
      const files = library.flattenFiles(await library.buildTree(dir))
      const results = await searchLibrary(dir, files, str(a, 'query'), ctx?.settings)
      if (!results.length) return 'No matching notes found.'
      const lines = results.map(
        (r, i) => `${i + 1}. ${r.id}\n   ${r.snippet || '(empty note)'}`,
      )
      return `Most relevant notes (best first):\n\n${lines.join('\n')}\n\nUse read_file to read any of these in full.`
    }
    case 'read_file':
      return await library.readNote(dir, str(a, 'path'))
    case 'write_file': {
      const path = str(a, 'path')
      // Keep a restorable snapshot of anything the AI is about to overwrite.
      try {
        const before = await library.readNote(dir, path)
        if (before.trim()) await history.snapshotNote(dir, path, before, 'ai')
      } catch {
        // New file — nothing to snapshot.
      }
      await library.writeNote(dir, path, str(a, 'content'))
      return `Saved ${path}`
    }
    case 'create_folder':
      await library.ensureFolder(dir, str(a, 'path'))
      return `Created folder ${str(a, 'path')}`
    case 'move_file':
      await library.movePath(dir, str(a, 'from'), str(a, 'to'))
      await history.retargetHistory(dir, str(a, 'from'), str(a, 'to'))
      return `Moved ${str(a, 'from')} to ${str(a, 'to')}`
    case 'delete_file':
      await library.trashNote(dir, str(a, 'path'))
      return `Moved ${str(a, 'path')} to the recycle bin`
    case 'delete_folder':
      await library.trashFolder(dir, str(a, 'path'))
      return `Moved folder ${str(a, 'path')} to the recycle bin`
    default:
      throw new Error(`Unknown tool: ${call.name}`)
  }
}

export interface ActionPreview {
  /** A "write" preview shows a before/after diff; "generic" is a one-line summary. */
  kind: 'write' | 'generic'
  summary: string
  path?: string
  before?: string
  after?: string
}

/** Build a human-readable preview of a mutating tool call for the approval card. */
export async function buildPreview(
  dir: FileSystemDirectoryHandle,
  call: ToolCall,
): Promise<ActionPreview> {
  const a = call.arguments
  switch (call.name) {
    case 'write_file': {
      const path = str(a, 'path')
      let before = ''
      try {
        before = await library.readNote(dir, path)
      } catch {
        before = ''
      }
      return {
        kind: 'write',
        summary: before ? `Overwrite ${path}` : `Create ${path}`,
        path,
        before,
        after: str(a, 'content'),
      }
    }
    case 'create_folder':
      return { kind: 'generic', summary: `Create folder “${str(a, 'path')}”` }
    case 'move_file':
      return {
        kind: 'generic',
        summary: `Move “${str(a, 'from')}” → “${str(a, 'to')}”`,
      }
    case 'delete_file':
      return {
        kind: 'generic',
        summary: `Move “${str(a, 'path')}” to the recycle bin`,
      }
    case 'delete_folder':
      return {
        kind: 'generic',
        summary: `Move folder “${str(a, 'path')}” and its notes to the recycle bin`,
      }
    default:
      return { kind: 'generic', summary: `${call.name}(${JSON.stringify(a)})` }
  }
}
