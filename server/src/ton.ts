import { Address, beginCell } from '@ton/core'

/** Demos must not move real money, so Hands Up only talks to TON testnet. */
export const TON_CHAIN = '-3'
const API = 'https://testnet.toncenter.com/api/v3'

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

type TxResponse = {
  transactions: Array<{
    hash: string
    description?: {
      aborted?: boolean
      credit_ph?: { credit?: string | null } | null
      bounce?: unknown
    }
    in_msg?: {
      source?: string | null
      value?: string | null
      message_content?: { decoded?: { type?: string; comment?: string } | null } | null
    } | null
  }>
}

/**
 * Reads the host wallet's recent incoming transfers and returns the tips for
 * one question. The money goes straight from the asker to the host; Hands Up
 * only reads the chain and never holds funds.
 */
export async function findTips(wallet: string, questionId: string): Promise<Tip[]> {
  const raw = Address.parse(wallet).toRawString()
  const url = `${API}/transactions?account=${encodeURIComponent(raw)}&limit=50&sort=desc`
  const headers: Record<string, string> = {}
  if (process.env.TONCENTER_API_KEY) headers['x-api-key'] = process.env.TONCENTER_API_KEY
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`toncenter ${res.status}`)
  const data = (await res.json()) as TxResponse
  const comment = tipComment(questionId)
  const tips: Tip[] = []
  for (const tx of data.transactions ?? []) {
    const msg = tx.in_msg
    const decoded = msg?.message_content?.decoded
    if (!msg?.source || decoded?.type !== 'text_comment' || decoded.comment?.trim() !== comment) continue
    // A new wallet that has never sent anything has no code yet, so testnet marks
    // every incoming transfer "aborted" even though the coins are credited. What
    // matters is whether the money stayed: a bounced transfer went back to the sender.
    if (tx.description?.bounce) continue
    const amount = Number(tx.description?.credit_ph?.credit ?? msg.value ?? 0) / NANO
    if (amount <= 0) continue
    tips.push({ hash: tx.hash, amount, from: msg.source })
  }
  return tips
}

export const toNano = (ton: number) => String(Math.round(ton * NANO))
