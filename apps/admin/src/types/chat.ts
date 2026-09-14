export type Message = {
  id: string
  author: 'assistant' | 'user'
  text: string
  time: string
  suggestions?: string[]
  failed?: boolean
}
