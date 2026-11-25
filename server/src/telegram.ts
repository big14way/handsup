import { webhookCallback } from 'grammy'
import { createBot } from './bot.js'

const token = process.env.BOT_TOKEN

/** Null until BOT_TOKEN is set, so the rest of the server runs without Telegram. */
export const bot = token ? createBot(token) : null

export const webhook = bot
  ? webhookCallback(bot, 'hono', { secretToken: process.env.TELEGRAM_WEBHOOK_SECRET })
  : null
