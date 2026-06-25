export type Provider = 'anthropic' | 'openai' | 'lmstudio'

export interface AssistantSettings {
  provider: Provider
  anthropicKey: string
  openaiKey: string
  lmstudioUrl: string
  models: {
    anthropic: string
    openai: string
    lmstudio: string
  }
  /** Enable extended ("adaptive") thinking — Claude only. */
  thinking: boolean
  /** Optional custom instructions appended to the system prompt. */
  systemPrompt: string
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type ChatRole = 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  /** assistant: tool calls it wants to make */
  toolCalls?: ToolCall[]
  /** tool: which call this is the result of */
  toolCallId?: string
  toolName?: string
  isError?: boolean
  /**
   * assistant: the provider's native content blocks, resent verbatim so
   * Claude's thinking blocks (with signatures) are preserved across turns.
   */
  providerRaw?: unknown
}

export interface ProviderTurn {
  text: string
  toolCalls: ToolCall[]
  /** Provider-native assistant content (Anthropic content blocks), if any. */
  raw?: unknown
}

/** A normalized tool definition shared by both provider wire formats. */
export interface ToolDef {
  name: string
  description: string
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>
  /** Read-only tools run without asking; the rest go through the approval gate. */
  readOnly: boolean
}
