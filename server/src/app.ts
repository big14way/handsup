import { Hono } from 'hono'
import { cors } from 'hono/cors'
import * as db from './db.js'
import { shorten, summarise } from './ai.js'
import { notify } from './notify.js'

const DEV = process.env.DEV_AUTH === '1'

type HostEnv = { Variables: { session: db.Session } }

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
      const q = await db.addQuestion({ sessionId: session.id, tgUserId: votes, tgName: name, text, short: await shorten(text) })
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
