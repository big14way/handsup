import { Bot, InlineKeyboard, type Context } from 'grammy'
import * as db from './db.js'
import { ask } from './questions.js'
import { setNotifier } from './notify.js'
import { displayName } from './tgauth.js'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const isGroup = (ctx: Context) => ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'

async function isAdmin(ctx: Context): Promise<boolean> {
  if (!ctx.chat || !ctx.from) return false
  const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id)
  return member.status === 'creator' || member.status === 'administrator'
}

const codeMessage = (session: db.Session) =>
  `Your host code for <b>${esc(session.chat_title)}</b>:\n\n<code>${session.code}</code>\n\n` +
  'Open Hands Up on your glasses and enter it on your phone. The code works once.'

export function createBot(token: string): Bot {
  const bot = new Bot(token)

  // /host: an admin opens a Q&A for this group.
  bot.command('host', async ctx => {
    if (!isGroup(ctx)) return ctx.reply('Add me to a group and send /host there to start a Q&A.')
    if (!(await isAdmin(ctx))) return ctx.reply('Only a group admin can start a Q&A.')
    const running = await db.liveSessionForChat(ctx.chat.id)
    if (running) {
      return ctx.reply(`A Q&A is already running here, hosted by ${running.host_name ?? 'an admin'}. Send /end to close it first.`)
    }
    const session = await db.createSession({
      chatId: ctx.chat.id,
      chatTitle: ctx.chat.title ?? 'Q&A',
      hostTgId: ctx.from!.id,
      hostName: displayName(ctx.from!),
    })

    const me = ctx.me.username
    await ctx.reply(
      `<b>Q&amp;A is live</b> with ${esc(session.host_name ?? 'the host')}.\n\n` +
        'Ask a question and upvote the ones you want answered. The top question goes straight to the host’s glasses.\n\n' +
        'You can also type <code>/ask your question</code> here.',
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().url('Ask or upvote', `https://t.me/${me}?startapp=${session.id}`),
      },
    )

    // The code goes to the host privately, so nobody else in the group can pair as host.
    try {
      await ctx.api.sendMessage(ctx.from!.id, codeMessage(session), { parse_mode: 'HTML' })
    } catch {
      await ctx.reply('Host: tap below to get your private code for the glasses.', {
        reply_markup: new InlineKeyboard().url('Get my host code', `https://t.me/${me}?start=code_${session.id}`),
      })
    }
  })

  bot.command('start', async ctx => {
    const payload = ctx.match
    if (ctx.chat.type === 'private' && payload.startsWith('code_')) {
      const session = await db.sessionById(payload.slice(5)).catch(() => null)
      if (!session || session.status !== 'live' || String(session.host_tg_id) !== String(ctx.from?.id)) {
        return ctx.reply('That link is only for the host of a running Q&A.')
      }
      if (session.host_token) return ctx.reply('Your glasses are already connected to this Q&A.')
      return ctx.reply(codeMessage(session), { parse_mode: 'HTML' })
    }
    return ctx.reply(
      'Hands Up runs live Q&A for a Telegram group and shows the top question on the host’s Even G2 glasses.\n\n' +
        'Add me to your group, then send /host there.',
    )
  })

  // /ask: a question typed straight into the group.
  bot.command('ask', async ctx => {
    if (!isGroup(ctx) || !ctx.from) return
    const session = await db.liveSessionForChat(ctx.chat.id)
    if (!session) return ctx.reply('No Q&A is running. An admin can start one with /host.')
    const result = await ask(session, { id: ctx.from.id, name: displayName(ctx.from) }, ctx.match, ctx.msg.message_id)
    if ('error' in result) return ctx.reply(result.error, { reply_parameters: { message_id: ctx.msg.message_id } })
    if (result.merged) {
      return ctx.reply('Someone already asked that, so your vote was added to their question.', {
        reply_parameters: { message_id: ctx.msg.message_id },
      })
    }
    // A reaction instead of a reply keeps the group quiet.
    await ctx.react('👍').catch(() => {})
  })

  bot.command('end', async ctx => {
    if (!isGroup(ctx) || !ctx.from) return
    const session = await db.liveSessionForChat(ctx.chat.id)
    if (!session) return ctx.reply('No Q&A is running.')
    if (String(session.host_tg_id) !== String(ctx.from.id) && !(await isAdmin(ctx))) {
      return ctx.reply('Only the host or an admin can end the Q&A.')
    }
    await db.endSession(session.id)
    const { answered } = await db.counts(session.id)
    await ctx.reply(endedText(answered))
  })

  bot.catch(err => console.error('bot error', err.error))

  setNotifier({
    async answered(session, question, summary) {
      if (!session.chat_id) return
      const lines = [`<b>Answered</b> · ${esc(question.tg_name)} asked:`, `<i>${esc(question.text)}</i>`]
      if (summary) lines.push('', esc(summary))
      await bot.api.sendMessage(Number(session.chat_id), lines.join('\n'), {
        parse_mode: 'HTML',
        reply_parameters: question.tg_message_id
          ? { message_id: Number(question.tg_message_id), allow_sending_without_reply: true }
          : undefined,
      })
    },
    // Skips stay silent: nobody needs a public notice that their question was passed over.
    async skipped() {},
    async ended(session, answered) {
      if (!session.chat_id) return
      await bot.api.sendMessage(Number(session.chat_id), endedText(answered))
    },
  })

  return bot
}

function endedText(answered: number): string {
  const n = answered === 1 ? '1 question' : `${answered} questions`
  return `The Q&A has ended. ${n} answered. Thanks for asking.`
}

/** Commands shown in Telegram's menu. Run once after creating the bot. */
export async function registerCommands(bot: Bot): Promise<void> {
  await bot.api.setMyCommands(
    [
      { command: 'host', description: 'Start a Q&A in this group (admins)' },
      { command: 'ask', description: 'Ask the host a question' },
      { command: 'end', description: 'End the Q&A' },
    ],
    { scope: { type: 'all_group_chats' } },
  )
}
