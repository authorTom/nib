import { useCallback, useRef, useState } from 'react'
import { runTurn } from './providers'
import { buildPreview, executeTool, toolByName, TOOL_DEFS } from './tools'
import type { ActionPreview } from './tools'
import { loadSettings, saveSettings } from './settings'
import type { AssistantSettings, ChatMessage, ToolCall } from './types'

export type AssistantStatus = 'idle' | 'thinking' | 'awaiting-approval' | 'error'

export interface PendingAction {
  id: string
  toolName: string
  preview: ActionPreview
  status: 'pending' | 'approved' | 'rejected'
}

const SYSTEM_PROMPT = `You are Nib's built-in assistant, embedded in a local Markdown note-taking app.
The user's notes are plain Markdown (.md) files in a folder ("vault"). You can read and
edit them with the provided tools.

Guidelines:
- Call list_files first to understand the vault, then read_file before editing a note.
- Keep notes as clean Markdown. Preserve the user's existing content unless asked to change it.
- Use exact relative paths (e.g. "Projects/idea.md"). Folders use create_folder.
- Creating, editing, moving, and deleting require the user's approval before they take effect —
  make each change purposeful and explain what you're doing.
- Be concise. When the task is done, briefly summarize what you changed.`

interface UseAssistantOptions {
  getDir: () => FileSystemDirectoryHandle | null
  onMutated: () => void
  /** Path of the note currently open in the editor, if any. */
  getActivePath: () => string | null
}

let counter = 0
const uid = () => `m${Date.now()}_${counter++}`

interface GateContext {
  dir: FileSystemDirectoryHandle
  working: ChatMessage[]
  items: { call: ToolCall; action: PendingAction }[]
  resolve: () => void
}

export function useAssistant({
  getDir,
  onMutated,
  getActivePath,
}: UseAssistantOptions) {
  const [settings, setSettingsState] = useState<AssistantSettings>(loadSettings)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<AssistantStatus>('idle')
  const [pending, setPending] = useState<PendingAction[]>([])

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const abortRef = useRef<AbortController | null>(null)
  const gateRef = useRef<GateContext | null>(null)
  const mutatedRef = useRef(false)

  const updateSettings = useCallback((next: AssistantSettings) => {
    setSettingsState(next)
    saveSettings(next)
  }, [])

  const commit = useCallback((working: ChatMessage[]) => {
    setMessages([...working])
  }, [])

  const safeExec = useCallback(
    async (dir: FileSystemDirectoryHandle, call: ToolCall) => {
      try {
        return { content: await executeTool(dir, call), isError: false }
      } catch (e) {
        return { content: `Error: ${(e as Error).message}`, isError: true }
      }
    },
    [],
  )

  const finishGateItem = useCallback(
    async (id: string, approve: boolean) => {
      const ctx = gateRef.current
      if (!ctx) return
      const entry = ctx.items.find((i) => i.action.id === id)
      if (!entry || entry.action.status !== 'pending') return

      let content: string
      let isError = false
      if (approve) {
        const r = await safeExec(ctx.dir, entry.call)
        content = r.content
        isError = r.isError
        if (!isError) mutatedRef.current = true
      } else {
        content = 'The user declined this action.'
        isError = true
      }
      entry.action.status = approve ? 'approved' : 'rejected'
      ctx.working.push({
        id: uid(),
        role: 'tool',
        toolCallId: entry.call.id,
        toolName: entry.call.name,
        content,
        isError,
      })
      commit(ctx.working)
      setPending(ctx.items.map((i) => ({ ...i.action })))

      if (ctx.items.every((i) => i.action.status !== 'pending')) {
        if (mutatedRef.current) {
          onMutated()
          mutatedRef.current = false
        }
        const resolve = ctx.resolve
        gateRef.current = null
        setPending([])
        resolve()
      }
    },
    [commit, onMutated, safeExec],
  )

  const gate = useCallback(
    (dir: FileSystemDirectoryHandle, working: ChatMessage[], items: GateContext['items']) =>
      new Promise<void>((resolve) => {
        gateRef.current = { dir, working, items, resolve }
        setPending(items.map((i) => ({ ...i.action })))
        setStatus('awaiting-approval')
      }),
    [],
  )

  const runLoop = useCallback(
    async (dir: FileSystemDirectoryHandle, working: ChatMessage[], signal: AbortSignal) => {
      const activePath = getActivePath()
      const custom = settingsRef.current.systemPrompt.trim()
      const system = [
        SYSTEM_PROMPT,
        activePath
          ? `The note currently open in the editor is "${activePath}". When the user says "this note" or asks you to summarize/edit something without naming a file, assume they mean this note and read it first — do not ask for a path.`
          : '',
        custom ? `Additional instructions from the user:\n${custom}` : '',
      ]
        .filter(Boolean)
        .join('\n\n')

      for (let guard = 0; guard < 50; guard++) {
        setStatus('thinking')
        const turn = await runTurn(settingsRef.current, system, working, TOOL_DEFS, signal)
        working.push({
          id: uid(),
          role: 'assistant',
          content: turn.text,
          toolCalls: turn.toolCalls,
          providerRaw: turn.raw,
        })
        commit(working)

        if (turn.toolCalls.length === 0) {
          setStatus('idle')
          return
        }

        const toApprove: GateContext['items'] = []
        for (const call of turn.toolCalls) {
          const def = toolByName(call.name)
          if (def?.readOnly) {
            const r = await safeExec(dir, call)
            working.push({
              id: uid(),
              role: 'tool',
              toolCallId: call.id,
              toolName: call.name,
              content: r.content,
              isError: r.isError,
            })
            commit(working)
          } else {
            toApprove.push({
              call,
              action: {
                id: call.id,
                toolName: call.name,
                preview: await buildPreview(dir, call),
                status: 'pending',
              },
            })
          }
        }

        if (toApprove.length) {
          await gate(dir, working, toApprove)
        }
      }
    },
    [commit, gate, getActivePath, safeExec],
  )

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || status === 'thinking' || status === 'awaiting-approval') return
      const dir = getDir()
      if (!dir) return

      const working: ChatMessage[] = [
        ...messagesRef.current,
        { id: uid(), role: 'user', content: trimmed },
      ]
      commit(working)

      const controller = new AbortController()
      abortRef.current = controller
      try {
        await runLoop(dir, working, controller.signal)
      } catch (e) {
        const err = e as Error
        if (err.name === 'AbortError') {
          setStatus('idle')
        } else {
          working.push({
            id: uid(),
            role: 'assistant',
            content: `⚠️ ${err.message}`,
            isError: true,
          })
          commit(working)
          setStatus('error')
        }
      } finally {
        abortRef.current = null
      }
    },
    [commit, getDir, runLoop, status],
  )

  const approve = useCallback((id: string) => void finishGateItem(id, true), [finishGateItem])
  const reject = useCallback((id: string) => void finishGateItem(id, false), [finishGateItem])
  const approveAll = useCallback(async () => {
    const ctx = gateRef.current
    if (!ctx) return
    for (const item of ctx.items) {
      if (item.action.status === 'pending') await finishGateItem(item.action.id, true)
    }
  }, [finishGateItem])

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clear = useCallback(() => {
    if (status === 'thinking' || status === 'awaiting-approval') return
    setMessages([])
    setStatus('idle')
  }, [status])

  return {
    settings,
    updateSettings,
    messages,
    status,
    pending,
    send,
    approve,
    reject,
    approveAll,
    stop,
    clear,
  }
}
