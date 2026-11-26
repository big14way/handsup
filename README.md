# Hands Up

Live audience Q&A for Even Realities G2 glasses, run through Telegram.

A speaker, AMA host or community manager cannot look at a phone while talking to a room. Hands Up puts the single top audience question on the lens. One tap marks it answered and brings the next one. The answer the host speaks is turned into a short written summary that one more tap posts to the Telegram group.

Built for **Heads Up: Even Realities Hackathon** (Nov 23–29, 2026).

## What existed before Nov 23

Nothing. All code in this repository was written during the build week. It uses open-source libraries (Even Hub SDK, Hono, Vite) and the official `evenhub-templates` minimal template as a reference for event handling.

## Layout

- `glasses/` the Even Hub app (Vite + TypeScript, `@evenrealities/even_hub_sdk`)
- `server/` the API the glasses talk to (Hono, Neon Postgres)

## Run it locally

Requires Node 22 or newer and a Postgres database (a free Neon project works).

```sh
npm install
cp server/.env.example server/.env    # set DATABASE_URL, and DEV_AUTH=1 for local testing
npm run migrate -w server
npm run dev:server                    # http://localhost:8788
npm run dev:glasses                   # http://localhost:5173
```

With `DEV_AUTH=1`, create a test session with sample questions and open it in the simulator:

```sh
curl -X POST http://localhost:8788/api/dev/seed        # prints a 6-digit host code
npx evenhub-simulator "http://localhost:5173/?code=<code>"
```

## On the glasses

| Gesture | Question on the lens | Drafted answer on the lens |
|---|---|---|
| Tap | Mark answered | Post the summary to the group |
| Swipe down | Skip | Keep it private |
| Double-tap | Exit | Exit |

Demos use testnet or read-only data only. No API keys are shipped in the app; every external call goes through the server.
