import type { SupportChatMessage, SupportChatRequest, SupportChatResponse } from '@support-hub/contracts'

export async function sendChatMessage(messages: SupportChatMessage[]): Promise<SupportChatResponse> {
  const body: SupportChatRequest = { messages }
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(result?.error ?? 'Não foi possível enviar a mensagem')
  }

  return response.json() as Promise<SupportChatResponse>
}
