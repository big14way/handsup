export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8788'

export type Current = {
  id: string
  phase: 'question' | 'draft'
  short: string
  name: string
  votes: number
  boost: number
  draft: string | null
}

export type HostState = {
  title: string
  status: 'live' | 'ended'
  waiting: number
  answered: number
  current: Current | null
}

export class Unauthorized extends Error {}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.token) headers.set('authorization', `Bearer ${init.token}`)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const res = await fetch(API_BASE + path, { ...init, headers, signal: controller.signal })
    if (res.status === 401) throw new Unauthorized()
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
    return body as T
  } finally {
    clearTimeout(timer)
  }
}

export function pair(code: string) {
  return call<{ token: string; title: string }>('/api/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  })
}

export const getState = (token: string) => call<HostState>('/api/host/state', { token })

export const done = (token: string) => call<HostState>('/api/host/done', { method: 'POST', token })

export const skip = (token: string) => call<HostState>('/api/host/skip', { method: 'POST', token })

export const end = (token: string) => call<HostState>('/api/host/end', { method: 'POST', token })

export function decideDraft(token: string, post: boolean) {
  return call<HostState>('/api/host/draft', {
    method: 'POST',
    token,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ post }),
  })
}

/** Raw 16 kHz mono 16-bit PCM of the host answering the question out loud. */
export function sendAudio(token: string, questionId: string, pcm: Uint8Array) {
  return call<{ ok: boolean }>(`/api/host/audio?q=${encodeURIComponent(questionId)}`, {
    method: 'POST',
    token,
    headers: { 'content-type': 'application/octet-stream' },
    body: pcm as unknown as BodyInit,
  })
}
