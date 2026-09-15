import type {
  ApiError,
  KnowledgeItem,
  KnowledgeListResponse,
  KnowledgeUpdate,
  KnowledgeWrite,
} from '@support-hub/contracts'

export type AdminSession = { role: 'admin'; companyId: string; userId: string }

export class AdminApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as ApiError | null
    throw new AdminApiError(response.status, body?.code ?? 'request_failed', body?.error ?? 'Não foi possível concluir a operação.')
  }
  return (response.status === 204 ? undefined : await response.json()) as T
}

export const adminApi = {
  session: () => request<AdminSession>('/session'),
  login: (token: string) => request<AdminSession>('/login', {
    method: 'POST', body: JSON.stringify({ token: token.trim() }),
  }),
  logout: () => request<void>('/session', { method: 'DELETE' }),
  list: () => request<KnowledgeListResponse>('/knowledge'),
  create: (value: KnowledgeWrite) => request<KnowledgeItem>('/knowledge', {
    method: 'POST', body: JSON.stringify(value),
  }),
  update: (id: string, value: KnowledgeUpdate) => request<KnowledgeItem>(`/knowledge/${id}`, {
    method: 'PUT', body: JSON.stringify(value),
  }),
  publish: (id: string, expectedRevision: number) => request<KnowledgeItem>(`/knowledge/${id}/publish`, {
    method: 'POST', body: JSON.stringify({ expectedRevision }),
  }),
  unpublish: (id: string) => request<KnowledgeItem>(`/knowledge/${id}/unpublish`, {
    method: 'POST', body: JSON.stringify({}),
  }),
}
