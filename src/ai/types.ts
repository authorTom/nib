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
}

export interface ProviderTurn {
  text: string
  toolCalls: ToolCall[]
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
