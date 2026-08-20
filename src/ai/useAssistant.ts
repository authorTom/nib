import { useCallback, useEffect, useRef, useState } from 'react'
import { runCompletion, runTurn } from './providers'
import { buildPreview, executeTool, toolByName, TOOL_DEFS } from './tools'
import type { ActionPreview } from './tools'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings'
import {
  loadShared,
  mergeShared,
  pickShared,
  saveShared,
  type Sharing,
} from './remoteSettings'
import { SYSTEM_PROMPT } from './prompt'
import { buildMemoryContext } from '../memory/context'
import { recordUses } from '../memory/store'
import type { AssistantSettings, ChatMessage, ToolCall } from './types'

export type AssistantStatus = 'idle' | 'thinking' | 'awaiting-approval' | 'error'

export interface PendingAction {
  id: string
  toolName: string
  preview: ActionPreview
  status: 'pending' | 'approved' | 'rejected'
}


interface UseAssistantOptions {
  getDir: () => FileSystemDirectoryHandle | null
  onMutated: () => void
  /** Path of the note currently open in the editor, if any. */
  getActivePath: () => string | null
  /** The assistant wrote to its own memory — the Memory panel is now stale. */
  onMemoryChanged?: () => void
  /**
   * Whether the settings (the API key above all) belong to this browser or to
   * the server every device signs in to. See src/ai/remoteSettings.ts.
   */
  sharing?: Sharing
}

let counter = 0
const uid = () => `m${Date.now()}_${counter++}`

/**
 * Is there anything here worth putting on the server?
 *
 * Only asked when the server has no settings of its own. A browser that has
 * never been given a key has nothing to seed with, and pushing its defaults up
 * would just overwrite the next device's real settings with blanks.
 */
function hasKey(settings: AssistantSettings): boolean {
  return !!(settings.anthropicKey || settings.openaiKey || settings.openrouterKey)
}

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
  onMemoryChanged,
  sharing = 'local',
}: UseAssistantOptions) {
  const [settings, setSettingsState] = useState<AssistantSettings>(loadSettings)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<AssistantStatus>('idle')
  const [pending, setPending] = useState<PendingAction[]>([])

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  // Read inside updateSettings, which is created once and would otherwise
  // capture whichever backend was open when the panel first rendered.
  const sharingRef = useRef(sharing)
  sharingRef.current = sharing
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const abortRef = useRef<AbortController | null>(null)
  const gateRef = useRef<GateContext | null>(null)
  const mutatedRef = useRef(false)

  // Says so when the server wouldn't take the settings, rather than leaving
  // the user to discover on their next device that the key never travelled.
  const [settingsError, setSettingsError] = useState<string | null>(null)

  const updateSettings = useCallback(
    (next: AssistantSettings) => {
      setSettingsState(next)
      // localStorage is written either way: it is this browser's cache of the
      // shared settings, so a reload comes up configured without waiting for a
      // round trip, and a server that is down doesn't take the assistant with it.
      saveSettings(next)
      if (sharingRef.current !== 'server') {
        setSettingsError(null)
        return
      }
      void saveShared(pickShared(next)).then(
        () => setSettingsError(null),
        (err: unknown) =>
          setSettingsError(
            err instanceof Error
              ? `Saved here, but not on the server: ${err.message}`
              : 'Saved here, but the server did not take a copy.',
          ),
      )
    },
    [],
  )

  /**
   * Give back the settings the server lent this browser.
   *
   * Called when signing out of a server library. The key came from the server
   * and every device that signs in gets it again, so there is no reason for it
   * to outlive the session here — and on a borrowed or shared machine, every
   * reason for it not to. Settings that were only ever local are left alone.
   */
  const forgetSharedSettings = useCallback(() => {
    if (sharingRef.current !== 'server') return
    const next = {
      ...DEFAULT_SETTINGS,
      // Never came from the server, so it isn't the server's to take back.
      lmstudioUrl: settingsRef.current.lmstudioUrl,
    }
    setSettingsState(next)
    saveSettings(next)
    setSettingsError(null)
  }, [])

  // Adopt the server's settings when a server library opens, and seed the
  // server from this browser when it has none yet — the first device to sign in
  // brings the key with it rather than finding an empty box.
  useEffect(() => {
    if (sharing !== 'server') return
    let cancelled = false
    void (async () => {
      try {
        const shared = await loadShared()
        if (cancelled) return
        if (shared) {
          const merged = mergeShared(settingsRef.current, shared)
          setSettingsState(merged)
          saveSettings(merged)
        } else if (hasKey(settingsRef.current)) {
          await saveShared(pickShared(settingsRef.current))
        }
        if (!cancelled) setSettingsError(null)
      } catch (err: unknown) {
        if (cancelled) return
        setSettingsError(
          err instanceof Error
            ? `Couldn't read the settings this server keeps: ${err.message}`
            : "Couldn't read the settings this server keeps.",
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sharing])

  const commit = useCallback((working: ChatMessage[]) => {
    setMessages([...working])
  }, [])

  const safeExec = useCallback(
    async (dir: FileSystemDirectoryHandle, call: ToolCall) => {
      try {
        const content = await executeTool(dir, call, {
          settings: settingsRef.current,
        })
        return { content, isError: false }
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

      // Memory is ranked against the message that opened this exchange, and
      // built once per send rather than per tool-calling step: the user's
      // question doesn't change mid-loop, and rebuilding it every step would
      // pay for the same tokens five times over and defeat prompt caching.
      const lastUser = [...working].reverse().find((m) => m.role === 'user')
      const memoryBlock = settingsRef.current.memory
        ? await buildMemoryContext(dir, lastUser?.content ?? '', {
            budget: settingsRef.current.memoryBudget,
          }).catch(() => null)
        : null

      if (memoryBlock?.used.length) {
        // Best-effort, and never awaited into the critical path.
        void recordUses(dir, memoryBlock.used)
      }

      const system = [
        SYSTEM_PROMPT,
        activePath
          ? `The note currently open in the editor is "${activePath}". When the user says "this note" or asks you to summarize/edit something without naming a file, assume they mean this note and read it first — do not ask for a path.`
          : '',
        // Custom instructions before memory: the user's standing orders outrank
        // anything the assistant decided to write down about them.
        custom ? `Additional instructions from the user:\n${custom}` : '',
        memoryBlock?.text ?? '',
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
          reasoning: turn.reasoning,
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
          // Reads, and the memory writes that touch no note, run straight
          // through; everything that can change the user's library stops here.
          if (def?.readOnly || def?.autoApply) {
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
            if (def.autoApply && !r.isError) onMemoryChanged?.()
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

      // Safety guard tripped: the model kept calling tools without finishing.
      // Surface it and return to idle instead of leaving the panel stuck.
      working.push({
        id: uid(),
        role: 'assistant',
        content: '⚠️ Stopped after too many consecutive tool calls. Send a message to continue.',
        isError: true,
      })
      commit(working)
      setStatus('idle')
    },
    [commit, gate, getActivePath, safeExec, onMemoryChanged],
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

  // One-shot transform/answer for the inline "Ask AI" popover.
  const complete = useCallback(
    (instruction: string, selectedText: string, signal: AbortSignal) => {
      const custom = settingsRef.current.systemPrompt.trim()
      const system = [
        `You are a writing assistant inside a Markdown note editor. The user selected some text and gave an instruction.`,
        `Respond with ONLY the result — the revised or requested text — as plain Markdown that matches the selection's style. No preamble, no commentary, no surrounding quotes or code fences unless they are part of the content. If the instruction is a question, answer it concisely.`,
        custom ? `Additional user instructions:\n${custom}` : '',
      ]
        .filter(Boolean)
        .join('\n\n')
      const userText = `Instruction: ${instruction}\n\nSelected text:\n${selectedText}`
      return runCompletion(settingsRef.current, system, userText, signal)
    },
    [],
  )

  const clear = useCallback(() => {
    if (status === 'thinking' || status === 'awaiting-approval') return
    setMessages([])
    setStatus('idle')
  }, [status])

  return {
    settings,
    updateSettings,
    settingsError,
    forgetSharedSettings,
    messages,
    status,
    pending,
    send,
    approve,
    reject,
    approveAll,
    stop,
    clear,
    complete,
  }
}
