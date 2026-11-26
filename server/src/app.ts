import { Hono } from 'hono'
import { cors } from 'hono/cors'
import * as db from './db.js'
import { summarise } from './ai.js'
import { transcribe } from './stt.js'
import { ask } from './questions.js'
import { webhook } from './telegram.js'
import { TIP_OPTIONS, TON_CHAIN, commentPayload, findTips, tipComment, toNano } from './ton.js'
import { notify } from './notify.js'
import { verifyInitData, type TgUser } from './tgauth.js'

const DEV = process.env.DEV_AUTH === '1'

type HostEnv = { Variables: { session: db.Session } }
type AudienceEnv = { Variables: { user: TgUser } }

export const app = new Hono()

app.use('/api/*', cors({ origin: '*', allowHeaders: ['authorization', 'content-type', 'x-telegram-init-data', 'x-dev-user'] }))

app.get('/api/health', c => c.json({ ok: true }))

// ---------- host (the glasses) ----------

app.post('/api/pair', async c => {
  const body = await c.req.json().catch(() => ({}))
  const code = String(body.code ?? '').replace(/\D/g, '')
  if (code.length !== 6) return c.json({ error: 'Enter the 6-digit code.' }, 400)
  const paired = await db.pairSession(code)
  if (!paired) return c.json({ error: 'That code is wrong or already used.' }, 404)
  return c.json({ token: paired.token, title: paired.session.chat_title })
})

const host = new Hono<HostEnv>()

host.use('*', async (c, next) => {
  const token = c.req.header('authorization')?.replace(/^Bearer /, '')
  const session = token ? await db.sessionByToken(token) : null
  if (!session) return c.json({ error: 'not paired' }, 401)
  c.set('session', session)
  await next()
})

async function hostState(session: db.Session) {
  if (session.status !== 'live') {
    const { answered } = await db.counts(session.id)
    return { title: session.chat_title, status: session.status, current: null, waiting: 0, answered }
  }
  const q = await db.currentQuestion(session.id)
  const { waiting, answered } = await db.counts(session.id)
  return {
    title: session.chat_title,
    status: session.status,
    waiting,
    answered,
    current: q && {
      id: q.id,
      phase: q.status === 'draft' ? 'draft' : 'question',
      short: q.short,
      name: q.tg_name,
      votes: q.votes,
      boost: Number(q.boost),
      draft: q.status === 'draft' ? q.summary : null,
    },
  }
}

host.get('/state', async c => c.json(await hostState(c.var.session)))

/**
 * One tap on a question. If the host said enough out loud, the question moves
 * to a draft summary that needs a second tap; otherwise it is simply answered.
 */
host.post('/done', async c => {
  const session = c.var.session
  const q = await db.currentQuestion(session.id)
  if (q?.status === 'live') {
    const draft = await summarise(q.text, q.transcript)
    if (draft) {
      await db.setStatus(q.id, 'draft', draft)
    } else {
      const done = await db.setStatus(q.id, 'answered')
      if (done) await notify.answered(session, done, null)
    }
  }
  return c.json(await hostState(session))
})

/** Second tap (post the draft) or swipe down (keep it to yourself). */
host.post('/draft', async c => {
  const session = c.var.session
  const body = await c.req.json().catch(() => ({}))
  const q = await db.currentQuestion(session.id)
  if (q?.status === 'draft') {
    const post = body.post === true
    if (!post) await db.clearSummary(q.id)
    const done = await db.setStatus(q.id, 'answered')
    if (done) await notify.answered(session, done, post ? q.summary : null)
  }
  return c.json(await hostState(session))
})

/** A chunk of the host answering out loud. Only kept while that question is still on the lens. */
host.post('/audio', async c => {
  const id = c.req.query('q') ?? ''
  const current = await db.currentQuestion(c.var.session.id)
  if (!current || current.id !== id || current.status !== 'live') return c.json({ ok: false })
  const pcm = new Uint8Array(await c.req.arrayBuffer())
  if (pcm.length > 2_000_000) return c.json({ error: 'chunk too large' }, 413)
  try {
    const text = await transcribe(pcm)
    if (text) await db.appendTranscript(id, text)
    return c.json({ ok: true, heard: text.length > 0 })
  } catch (e) {
    console.error('audio', e)
    return c.json({ ok: false })
  }
})

host.post('/skip', async c => {
  const session = c.var.session
  const q = await db.currentQuestion(session.id)
  if (q?.status === 'live') {
    const skipped = await db.setStatus(q.id, 'skipped')
    if (skipped) await notify.skipped(session, skipped)
  }
  return c.json(await hostState(session))
})

host.post('/end', async c => {
  const session = c.var.session
  await db.endSession(session.id)
  const { answered } = await db.counts(session.id)
  await notify.ended(session, answered)
  return c.json(await hostState({ ...session, status: 'ended' }))
})

app.route('/api/host', host)

// ---------- audience (the Telegram Mini App) ----------

const audience = new Hono<AudienceEnv>()

audience.use('*', async (c, next) => {
  let user: TgUser | null = null
  const initData = c.req.header('x-telegram-init-data')
  const botToken = process.env.BOT_TOKEN
  if (initData && botToken) user = verifyInitData(initData, botToken)
  const devUser = c.req.header('x-dev-user')
  if (!user && DEV && devUser) {
    const [id, ...name] = devUser.split(':')
    if (Number(id) > 0) user = { id: Number(id), name: name.join(':').slice(0, 40) || 'Dev' }
  }
  if (!user) return c.json({ error: 'Open this from Telegram.' }, 401)
  c.set('user', user)
  await next()
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

audience.get('/session/:sid', async c => {
  const sid = c.req.param('sid')
  const session = UUID.test(sid) ? await db.sessionById(sid) : null
  if (!session) return c.json({ error: 'This Q&A was not found.' }, 404)
  return c.json({
    title: session.chat_title,
    host: session.host_name,
    status: session.status,
    wallet: session.wallet,
    questions: (await db.listQuestions(session.id, c.var.user.id)).map(q => ({ ...q, boost: Number(q.boost) })),
  })
})

audience.post('/ask', async c => {
  const body = await c.req.json().catch(() => ({}))
  const sid = String(body.sid ?? '')
  const session = UUID.test(sid) ? await db.sessionById(sid) : null
  if (!session || session.status !== 'live') return c.json({ error: 'This Q&A has ended.' }, 404)
  const result = await ask(session, c.var.user, String(body.text ?? ''))
  if ('error' in result) return c.json(result, 400)
  return c.json({ id: result.question.id, merged: result.merged })
})

audience.post('/vote', async c => {
  const body = await c.req.json().catch(() => ({}))
  const id = String(body.qid ?? '')
  if (!/^\d+$/.test(id)) return c.json({ error: 'bad question' }, 400)
  const votes = await db.vote(id, c.var.user.id)
  return c.json({ votes })
})

/** What the Mini App needs to send a tip for one question through TON Connect. */
audience.get('/tip/:qid', async c => {
  const qid = c.req.param('qid')
  const q = /^\d+$/.test(qid) ? await db.questionById(qid) : null
  const session = q && (await db.sessionById(q.session_id))
  if (!q || !session || session.status !== 'live' || q.status !== 'open') {
    return c.json({ error: 'You can only tip a question that is still waiting.' }, 400)
  }
  if (!session.wallet) return c.json({ error: 'The host has not set a wallet for tips.' }, 400)
  const comment = tipComment(q.id)
  return c.json({
    network: TON_CHAIN,
    address: session.wallet,
    comment,
    payload: commentPayload(comment),
    options: TIP_OPTIONS.map(ton => ({ ton, nano: toNano(ton) })),
  })
})

/** Checks the chain for the tip and credits it. Safe to call repeatedly. */
audience.post('/tip/:qid/check', async c => {
  const qid = c.req.param('qid')
  const q = /^\d+$/.test(qid) ? await db.questionById(qid) : null
  const session = q && (await db.sessionById(q.session_id))
  if (!q || !session?.wallet) return c.json({ error: 'not found' }, 404)
  try {
    const tips = await findTips(session.wallet, q.id)
    let credited = 0
    for (const tip of tips) if (await db.addBoost(q.id, tip.hash, tip.amount, tip.from)) credited += tip.amount
    const fresh = await db.questionById(q.id)
    return c.json({ credited, boost: Number(fresh?.boost ?? 0) })
  } catch (e) {
    console.error('tip check', e)
    return c.json({ error: 'Could not reach TON testnet. Try again in a moment.' }, 502)
  }
})

app.route('/api/app', audience)

// ---------- Telegram ----------

app.post('/api/telegram', async c => {
  if (!webhook) return c.json({ error: 'bot not configured' }, 503)
  return webhook(c)
})

// ---------- local development only ----------

if (DEV) {
  app.post('/api/dev/seed', async c => {
    const session = await db.createSession({ chatTitle: 'TON Builders AMA' })
    const samples: Array<[string, string, number]> = [
      ['Ada', 'When does the testnet faucet come back? It has been down since Monday.', 12],
      ['Tunde', 'Will the grant programme accept solo builders or teams only?', 7],
      ['Maria', 'Can you explain how fees work for the first five transfers each day, and what happens after that?', 4],
    ]
    for (const [name, text, votes] of samples) {
      const q = await db.addQuestion({ sessionId: session.id, tgUserId: votes, tgName: name, text, short: text })
      await db.sql`update questions set votes = ${votes} where id = ${q.id}`
    }
    return c.json({ code: session.code, sessionId: session.id })
  })

  app.post('/api/dev/say', async c => {
    const body = await c.req.json()
    const q = await db.currentQuestion(String(body.sessionId))
    if (q) await db.appendTranscript(q.id, String(body.text))
    return c.json({ ok: Boolean(q) })
  })
}
