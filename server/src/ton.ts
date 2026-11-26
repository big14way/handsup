import { Address, beginCell } from '@ton/core'

/** Demos must not move real money, so Hands Up only talks to TON testnet. */
export const TON_CHAIN = '-3'
const API = 'https://testnet.toncenter.com/api/v2'

/** Tip sizes offered in the Mini App, in TON. */
export const TIP_OPTIONS = [0.1, 0.5, 1]
const NANO = 1_000_000_000

/** Normalises a wallet address typed by the host. Null when it is not a valid TON address. */
export function normaliseWallet(input: string): string | null {
  try {
    return Address.parse(input.trim()).toString({ testOnly: true, bounceable: false })
  } catch {
    return null
  }
}

/** The text comment that ties a transfer to one question. */
export const tipComment = (questionId: string) => `Hands Up tip #${questionId}`

/** A plain text comment, encoded the way TON Connect expects a message payload. */
export function commentPayload(text: string): string {
  return beginCell().storeUint(0, 32).storeStringTail(text).endCell().toBoc().toString('base64')
}

export type Tip = { hash: string; amount: number; from: string }

type V2Transaction = {
  transaction_id: { hash: string }
  in_msg?: { source?: string; value?: string; message?: string } | null
  out_msgs?: Array<{ destination?: string; message?: string }>
}

const TIP_PATTERN = /^Hands Up tip #(\d+)$/
/** A bounced transfer sends the money back with a body that starts with 0xFFFFFFFF ("/////w" in base64). */
const BOUNCE_PREFIX = '/////w'

const sameAddress = (a?: string, b?: string) => {
  try {
    return Boolean(a && b) && Address.parse(a!).equals(Address.parse(b!))
  } catch {
    return false
  }
}

/**
 * Reads the host wallet's recent incoming transfers and returns the Hands Up tips
 * among them, for any question. The money goes straight from the asker to the
 * host; Hands Up only reads the chain and never holds funds.
 *
 * This uses toncenter's v2 API, which reads the chain directly. The v3 index can
 * lag by minutes on testnet, which is too slow for a question to jump the queue
 * while the audience watches.
 */
export async function recentTips(wallet: string): Promise<Array<Tip & { questionId: string }>> {
  const url = `${API}/getTransactions?address=${encodeURIComponent(wallet)}&limit=50`
  const headers: Record<string, string> = {}
  if (process.env.TONCENTER_API_KEY) headers['x-api-key'] = process.env.TONCENTER_API_KEY
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`toncenter ${res.status}`)
  const data = (await res.json()) as { ok?: boolean; result?: V2Transaction[] }
  const tips: Array<Tip & { questionId: string }> = []
  for (const tx of data.result ?? []) {
    const msg = tx.in_msg
    const match = TIP_PATTERN.exec((msg?.message ?? '').trim())
    if (!msg?.source || !match) continue
    // Transfers to a wallet that has never sent anything still count: the coins
    // are credited. Only a transfer that bounced back to the sender does not.
    const bounced = (tx.out_msgs ?? []).some(
      out => sameAddress(out.destination, msg.source) && (out.message ?? '').startsWith(BOUNCE_PREFIX),
    )
    if (bounced) continue
    const amount = Number(msg.value ?? 0) / NANO
    if (amount <= 0) continue
    tips.push({ hash: tx.transaction_id.hash, amount, from: msg.source, questionId: match[1] })
  }
  return tips
}

export async function findTips(wallet: string, questionId: string): Promise<Tip[]> {
  return (await recentTips(wallet)).filter(tip => tip.questionId === questionId)
}

export const toNano = (ton: number) => String(Math.round(ton * NANO))
