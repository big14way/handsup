import { neon } from '@neondatabase/serverless'
import { randomBytes, randomInt } from 'node:crypto'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

export const sql = neon(url)

export type Session = {
  id: string
  code: string
  host_token: string | null
  chat_id: string | null
  chat_title: string
  host_tg_id: string | null
  host_name: string | null
  wallet: string | null
  status: 'live' | 'ended'
}

export type QuestionStatus = 'open' | 'live' | 'draft' | 'answered' | 'skipped'

export type Question = {
  id: string
  session_id: string
  tg_user_id: string
  tg_name: string
  text: string
  short: string
  votes: number
  boost: string
  status: QuestionStatus
  transcript: string
  summary: string | null
  tg_message_id: string | null
}

export async function createSession(input: {
  chatId?: number | null
  chatTitle: string
  hostTgId?: number | null
  hostName?: string | null
}): Promise<Session> {
  // Six digits is enough here: a code only pairs once and the session is short-lived.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = String(randomInt(100000, 1000000))
    const rows = (await sql`
      insert into sessions (code, chat_id, chat_title, host_tg_id, host_name)
      values (${code}, ${input.chatId ?? null}, ${input.chatTitle}, ${input.hostTgId ?? null}, ${input.hostName ?? null})
      on conflict (code) do nothing
      returning *`) as Session[]
    if (rows[0]) return rows[0]
  }
  throw new Error('could not allocate a session code')
}

/** Trades a host code for a bearer token. The code stops working once used. */
export async function pairSession(code: string): Promise<{ token: string; session: Session } | null> {
  const token = randomBytes(24).toString('base64url')
  const rows = (await sql`
    update sessions set host_token = ${token}
    where code = ${code} and status = 'live' and host_token is null
    returning *`) as Session[]
  return rows[0] ? { token, session: rows[0] } : null
}

export async function sessionByToken(token: string): Promise<Session | null> {
  const rows = (await sql`select * from sessions where host_token = ${token}`) as Session[]
  return rows[0] ?? null
}

export async function sessionById(id: string): Promise<Session | null> {
  const rows = (await sql`select * from sessions where id = ${id}`) as Session[]
  return rows[0] ?? null
}

export async function liveSessionForChat(chatId: number): Promise<Session | null> {
  const rows = (await sql`
    select * from sessions where chat_id = ${chatId} and status = 'live'
    order by created_at desc limit 1`) as Session[]
  return rows[0] ?? null
}

export async function endSession(id: string): Promise<void> {
  await sql`update sessions set status = 'ended' where id = ${id}`
}

export async function setWallet(id: string, wallet: string | null): Promise<void> {
  await sql`update sessions set wallet = ${wallet} where id = ${id}`
}

export async function addQuestion(input: {
  sessionId: string
  tgUserId: number
  tgName: string
  text: string
  short: string
  tgMessageId?: number
}): Promise<Question> {
  const rows = (await sql`
    insert into questions (session_id, tg_user_id, tg_name, text, short, tg_message_id)
    values (${input.sessionId}, ${input.tgUserId}, ${input.tgName}, ${input.text}, ${input.short}, ${input.tgMessageId ?? null})
    returning *`) as Question[]
  await sql`insert into votes (question_id, tg_user_id) values (${rows[0].id}, ${input.tgUserId})`
  return rows[0]
}

export async function openQuestions(sessionId: string): Promise<Array<{ id: string; text: string }>> {
  return (await sql`
    select id::text as id, text from questions
    where session_id = ${sessionId} and status = 'open'
    order by created_at desc limit 40`) as Array<{ id: string; text: string }>
}

/** Questions not answered yet, including the one on the host's glasses: what a new question can repeat. */
export async function unansweredQuestions(sessionId: string): Promise<Array<{ id: string; text: string }>> {
  return (await sql`
    select id::text as id, text from questions
    where session_id = ${sessionId} and status in ('open', 'live', 'draft')
    order by created_at desc limit 40`) as Array<{ id: string; text: string }>
}

export async function openCountFor(sessionId: string, tgUserId: number): Promise<number> {
  const rows = (await sql`
    select count(*)::int as n from questions
    where session_id = ${sessionId} and tg_user_id = ${tgUserId} and status = 'open'`) as { n: number }[]
  return rows[0].n
}

/** Adds one vote per person. Returns the new total, or null if they had already voted. */
export async function vote(questionId: string, tgUserId: number): Promise<number | null> {
  const inserted = await sql`
    insert into votes (question_id, tg_user_id) values (${questionId}, ${tgUserId})
    on conflict do nothing returning question_id`
  if (inserted.length === 0) return null
  const rows = (await sql`
    update questions set votes = votes + 1 where id = ${questionId} and status = 'open'
    returning votes`) as { votes: number }[]
  return rows[0]?.votes ?? null
}

export async function questionById(id: string): Promise<Question | null> {
  const rows = (await sql`select * from questions where id = ${id}`) as Question[]
  return rows[0] ?? null
}

/**
 * The question the host is looking at. If none is on the lens, the top open
 * one is promoted: paid boosts first, then votes, then oldest.
 */
export async function currentQuestion(sessionId: string): Promise<Question | null> {
  const live = (await sql`
    select * from questions where session_id = ${sessionId} and status in ('live', 'draft')
    order by live_at asc limit 1`) as Question[]
  if (live[0]) return live[0]
  const promoted = (await sql`
    update questions set status = 'live', live_at = now()
    where id = (
      select id from questions where session_id = ${sessionId} and status = 'open'
      order by boost desc, votes desc, created_at asc limit 1
      for update skip locked
    )
    returning *`) as Question[]
  return promoted[0] ?? null
}

export async function counts(sessionId: string): Promise<{ waiting: number; answered: number }> {
  const rows = (await sql`
    select
      count(*) filter (where status = 'open')::int as waiting,
      count(*) filter (where status = 'answered')::int as answered
    from questions where session_id = ${sessionId}`) as { waiting: number; answered: number }[]
  return rows[0]
}

export async function setStatus(
  id: string,
  status: QuestionStatus,
  summary?: string | null,
): Promise<Question | null> {
  const rows = (await sql`
    update questions set
      status = ${status},
      summary = coalesce(${summary ?? null}, summary),
      answered_at = case when ${status}::text = 'answered' then now() else answered_at end
    where id = ${id}
    returning *`) as Question[]
  return rows[0] ?? null
}

export async function clearSummary(id: string): Promise<void> {
  await sql`update questions set summary = null where id = ${id}`
}

export async function appendTranscript(id: string, text: string): Promise<void> {
  await sql`
    update questions set transcript = trim(transcript || ' ' || ${text})
    where id = ${id} and status = 'live'`
}

export async function listQuestions(sessionId: string, tgUserId: number) {
  return (await sql`
    select q.id, q.tg_name, q.text, q.votes, q.boost, q.status, q.summary,
      exists (select 1 from votes v where v.question_id = q.id and v.tg_user_id = ${tgUserId}) as voted,
      (q.tg_user_id = ${tgUserId}) as mine
    from questions q
    where q.session_id = ${sessionId} and q.status <> 'skipped'
    order by
      case q.status when 'live' then 0 when 'draft' then 0 when 'open' then 1 else 2 end,
      q.boost desc, q.votes desc, q.created_at asc
    limit 60`) as Array<{
    id: string
    tg_name: string
    text: string
    votes: number
    boost: string
    status: QuestionStatus
    summary: string | null
    voted: boolean
    mine: boolean
  }>
}

/** Credits one on-chain tip. Returns false if that transaction was already counted. */
export async function addBoost(questionId: string, txHash: string, amount: number, from: string): Promise<boolean> {
  const inserted = await sql`
    insert into boosts (tx_hash, question_id, amount, from_address)
    values (${txHash}, ${questionId}, ${amount}, ${from})
    on conflict do nothing returning tx_hash`
  if (inserted.length === 0) return false
  await sql`update questions set boost = boost + ${amount} where id = ${questionId}`
  return true
}
