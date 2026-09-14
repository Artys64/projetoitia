import { useEffect, useState } from 'react'
import { sendChatMessage } from '../services/chat'
import type { Message } from '../types/chat'

function initialMessages(): Message[] {
  return [
    {
      id: 'welcome',
      author: 'assistant',
      text: 'Oi! Eu sou a Nora, assistente virtual da Support Hub. Como posso ajudar você hoje?',
      time: currentTime(),
      suggestions: ['Esqueci minha senha', 'Conhecer os planos', 'Falar com uma pessoa'],
    },
  ]
}

function currentTime() {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())
}

function createMessage(
  author: Message['author'],
  text: string,
  options: Pick<Message, 'suggestions' | 'failed'> = {},
): Message {
  return {
    id: `${author}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    author,
    text,
    time: currentTime(),
    ...options,
  }
}

export function useChat() {
  const [messages, setMessages] = useState(initialMessages)
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  useEffect(() => {
    const updateConnection = () => setIsOnline(navigator.onLine)

    window.addEventListener('online', updateConnection)
    window.addEventListener('offline', updateConnection)

    return () => {
      window.removeEventListener('online', updateConnection)
      window.removeEventListener('offline', updateConnection)
    }
  }, [])

  async function submitMessage(text: string) {
    const normalizedText = text.trim()
    if (!normalizedText || isSending || !isOnline) return

    const userMessage = createMessage('user', normalizedText)
    const conversation = [
      ...messages.map((message) => ({ ...message, suggestions: undefined })),
      userMessage,
    ]

    setMessages(conversation)
    setDraft('')
    setIsSending(true)

    try {
      const result = await sendChatMessage(
        conversation
          .filter((message) => !message.failed)
          .slice(-12)
          .map((message) => ({ role: message.author, content: message.text })),
      )
      setMessages((current) => [
        ...current,
        createMessage('assistant', result.reply, {
          suggestions: result.suggestions,
        }),
      ])
    } catch (error) {
      setMessages((current) => [
        ...current,
        createMessage(
          'assistant',
          error instanceof Error
            ? error.message
            : 'Não consegui responder agora. Tente novamente em alguns instantes.',
          { failed: true, suggestions: ['Tentar novamente'] },
        ),
      ])
    } finally {
      setIsSending(false)
    }
  }

  function sendMessage() {
    void submitMessage(draft)
  }

  function useSuggestion(suggestion: string) {
    if (suggestion === 'Tentar novamente') {
      const lastUserMessage = [...messages]
        .reverse()
        .find((message) => message.author === 'user')

      if (lastUserMessage) void submitMessage(lastUserMessage.text)
      return
    }

    void submitMessage(suggestion)
  }

  return { messages, draft, setDraft, isSending, isOnline, sendMessage, useSuggestion }
}
