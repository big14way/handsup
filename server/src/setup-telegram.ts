// Points Telegram at the deployed server. Run once per deployment URL:
//   npm run telegram -w server -- https://your-app.vercel.app
import { registerCommands } from './bot.js'
import { bot } from './telegram.js'

const base = process.argv[2]?.replace(/\/$/, '')
if (!bot) throw new Error('BOT_TOKEN is not set')
if (!base?.startsWith('https://')) throw new Error('Pass the deployed https:// URL')

await bot.api.setWebhook(`${base}/api/telegram`, {
  secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
  allowed_updates: ['message'],
})
await registerCommands(bot)
const me = await bot.api.getMe()
console.log(`@${me.username} now delivers updates to ${base}/api/telegram`)
console.log(`Set the bot's Mini App URL in @BotFather to ${base}/app/`)
