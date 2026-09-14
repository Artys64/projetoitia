import { ChatHeader } from '../components/chat/ChatHeader'
import { MessageList } from '../components/chat/MessageList'
import { ChatComposer } from '../components/chat/ChatComposer'
import { useChat } from '../hooks/useChat'

export function Chatbot() {
  const chat = useChat()

  return (
    <main className="chatbot-page">
      <section className="chatbot" aria-label="Chat de suporte">
        <ChatHeader isOnline={chat.isOnline} />
        <MessageList messages={chat.messages} isSending={chat.isSending} onSuggestion={chat.useSuggestion} />
        <ChatComposer
          draft={chat.draft}
          isSending={chat.isSending}
          isOnline={chat.isOnline}
          onDraftChange={chat.setDraft}
          onSend={chat.sendMessage}
        />
      </section>
    </main>
  )
}
