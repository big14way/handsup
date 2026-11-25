import { createHmac, timingSafeEqual } from 'node:crypto'

export type TgUser = { id: number; name: string }

/**
 * Verifies the initData string a Telegram Mini App sends, as described in
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyInitData(initData: string, botToken: string, maxAgeSeconds = 86_400): TgUser | null {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')
  const checkString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expected = createHmac('sha256', secret).update(checkString).digest()
  const given = Buffer.from(hash, 'hex')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null

  const authDate = Number(params.get('auth_date'))
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) return null

  try {
    const user = JSON.parse(params.get('user') ?? '')
    if (typeof user.id !== 'number') return null
    return { id: user.id, name: displayName(user) }
  } catch {
    return null
  }
}

export function displayName(user: { first_name?: string; last_name?: string; username?: string }): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
  return (name || user.username || 'Someone').slice(0, 40)
}
