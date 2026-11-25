import * as db from './db.js'
import { shorten } from './ai.js'
import type { TgUser } from './tgauth.js'

export const MAX_QUESTION_CHARS = 280
const MAX_OPEN_PER_PERSON = 3

/** Adds a question from the Mini App or from /ask in the group. */
export async function ask(
  session: db.Session,
  user: TgUser,
  raw: string,
  tgMessageId?: number,
): Promise<{ question: db.Question } | { error: string }> {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (text.length < 5) return { error: 'Write a full question.' }
  if (text.length > MAX_QUESTION_CHARS) return { error: `Keep it under ${MAX_QUESTION_CHARS} characters.` }
  if ((await db.openCountFor(session.id, user.id)) >= MAX_OPEN_PER_PERSON) {
    return { error: `You already have ${MAX_OPEN_PER_PERSON} questions waiting.` }
  }
  const question = await db.addQuestion({
    sessionId: session.id,
    tgUserId: user.id,
    tgName: user.name,
    text,
    short: await shorten(text),
    tgMessageId,
  })
  return { question }
}
