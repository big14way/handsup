import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { app } from './app.js'
import { registerCommands } from './bot.js'
import { bot } from './telegram.js'

// On Vercel the files in public/ are served by the platform; locally Hono does it.
app.use('/*', serveStatic({ root: './public' }))

const port = Number(process.env.PORT ?? 8788)
serve({ fetch: app.fetch, port })
console.log(`Hands Up server on http://localhost:${port}`)

// Local development can talk to Telegram by long polling, so no public URL is needed.
// Polling removes the webhook, so it only runs when asked for: with the same bot
// token deployed, it would take the bot away from the live server.
if (bot && process.env.BOT_POLLING === '1') {
  await registerCommands(bot)
  void bot.start({ onStart: me => console.log(`Bot @${me.username} is polling`) })
}
