import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { app } from './app.js'
import { registerCommands } from './bot.js'
import { bot } from './telegram.js'

// On Vercel the files in public/ are served by the platform; locally Hono does it.
app.use('/*', serveStatic({ root: './public' }))

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port })
console.log(`Hands Up server on http://localhost:${port}`)

// Local development talks to Telegram by long polling, so no public URL is needed.
if (bot) {
  await registerCommands(bot)
  void bot.start({ onStart: me => console.log(`Bot @${me.username} is polling`) })
}
