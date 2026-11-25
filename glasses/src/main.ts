import { OsEventTypeList, waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import * as api from './api'
import { createLens, type Card } from './lens'

const TOKEN_KEY = 'handsup.token'
const MIC_KEY = 'handsup.mic'
const POLL_MS = 1500
/** 15 seconds of 16 kHz 16-bit mono audio per upload. */
const AUDIO_FLUSH_BYTES = 16_000 * 2 * 15

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const bridge = await waitForEvenAppBridge()

let token = (await bridge.getLocalStorage(TOKEN_KEY).catch(() => '')) || ''
let micWanted = (await bridge.getLocalStorage(MIC_KEY).catch(() => '')) !== 'off'
let state: api.HostState | null = null
let busy = false
let offline = false

// ---------- what goes on the lens ----------

function cardFor(): Card {
  if (!token) {
    return { head: 'HANDS UP', body: 'Open Hands Up on your phone and enter your host code.', foot: 'double-tap to exit' }
  }
  if (!state) return { head: 'HANDS UP', body: offline ? 'No connection. Retrying.' : ' ', foot: ' ' }
  if (state.status === 'ended') {
    return { head: state.title, body: `Session ended. ${state.answered} answered.`, foot: 'double-tap to exit' }
  }
  const q = state.current
  if (!q) {
    // Nothing to answer: keep the lens almost empty so the host can look at the room.
    return { head: ' ', body: ' ', foot: offline ? 'no connection' : `${state.answered} answered · none waiting` }
  }
  if (q.phase === 'draft') {
    return { head: 'POST THIS ANSWER?', body: q.draft ?? '', foot: busy ? 'working…' : 'tap: post · swipe down: keep private' }
  }
  const boost = q.boost > 0 ? ` · ${q.boost} TON` : ''
  const votes = q.votes === 1 ? '1 vote' : `${q.votes} votes`
  const waiting = state.waiting > 0 ? ` · ${state.waiting} more` : ''
  return {
    head: `${q.name} · ${votes}${boost}`,
    body: q.short,
    foot: busy ? 'working…' : `tap: answered · swipe down: skip${waiting}`,
  }
}

const lens = await createLens(bridge, cardFor())

// ---------- the phone screen, a mirror with the same actions ----------

function renderPhone(): void {
  $('pair').hidden = Boolean(token)
  $('live').hidden = !token
  const status = $('status')
  if (!token) {
    status.textContent = 'Type /host in your Telegram group, then enter the code the bot sends you.'
    return
  }
  if (!state) {
    status.textContent = offline ? 'No connection. Retrying.' : 'Loading your session…'
    return
  }
  const ended = state.status === 'ended'
  status.textContent = ended
    ? `${state.title} has ended. ${state.answered} answered.`
    : `${state.title} · ${state.answered} answered · ${state.waiting} waiting`
  const q = state.current
  $('meta').textContent = !q ? 'On your glasses' : q.phase === 'draft' ? 'Post this answer?' : `${q.name} · ${q.votes} votes`
  $('question').textContent = !q ? (ended ? '' : 'No questions waiting.') : q.phase === 'draft' ? (q.draft ?? '') : q.short
  $<HTMLButtonElement>('doneBtn').textContent = q?.phase === 'draft' ? 'Post' : 'Answered'
  $<HTMLButtonElement>('skipBtn').textContent = q?.phase === 'draft' ? 'Keep private' : 'Skip'
  $<HTMLButtonElement>('doneBtn').disabled = !q || busy
  $<HTMLButtonElement>('skipBtn').disabled = !q || busy
  $<HTMLButtonElement>('endBtn').hidden = ended
  $('micBtn').textContent = `Microphone: ${micWanted ? 'on' : 'off'}`
}

function render(): void {
  lens.show(cardFor())
  renderPhone()
}

// ---------- the host's spoken answer ----------

let micOn = false
let recordingFor: string | null = null
let chunks: Uint8Array[] = []
let chunkBytes = 0

async function flushAudio(): Promise<void> {
  if (!recordingFor || chunkBytes === 0) return
  const pcm = new Uint8Array(chunkBytes)
  let offset = 0
  for (const chunk of chunks) {
    pcm.set(chunk, offset)
    offset += chunk.length
  }
  chunks = []
  chunkBytes = 0
  await api.sendAudio(token, recordingFor, pcm).catch(e => console.warn('audio upload failed', e))
}

/** The microphone is only open while a question is on the lens. */
function syncMic(): void {
  const q = state?.status === 'live' && state.current?.phase === 'question' ? state.current : null
  const target = micWanted && q ? q.id : null
  if (target !== recordingFor) {
    chunks = []
    chunkBytes = 0
    recordingFor = target
  }
  const wantOn = target !== null
  if (wantOn !== micOn) {
    micOn = wantOn
    bridge.audioControl(wantOn).catch(e => console.warn('audioControl failed', e))
  }
}

function onAudio(pcm: Uint8Array): void {
  if (!recordingFor) return
  chunks.push(pcm)
  chunkBytes += pcm.length
  if (chunkBytes >= AUDIO_FLUSH_BYTES) void flushAudio()
}

// ---------- talking to the server ----------

function apply(next: api.HostState): void {
  state = next
  offline = false
  syncMic()
  render()
}

async function signOut(): Promise<void> {
  token = ''
  state = null
  await bridge.setLocalStorage(TOKEN_KEY, '')
  syncMic()
  render()
}

async function act(run: () => Promise<api.HostState>): Promise<void> {
  if (busy || !token) return
  busy = true
  render()
  try {
    apply(await run())
  } catch (e) {
    if (e instanceof api.Unauthorized) await signOut()
    else console.warn('action failed', e)
  } finally {
    busy = false
    render()
  }
}

/** Tap: the question is answered, or the drafted summary gets posted. */
function primary(): void {
  const q = state?.current
  if (!q) return
  if (q.phase === 'draft') void act(() => api.decideDraft(token, true))
  else
    void act(async () => {
      await flushAudio()
      return api.done(token)
    })
}

/** Swipe down: skip the question, or keep the drafted summary private. */
function secondary(): void {
  const q = state?.current
  if (!q) return
  if (q.phase === 'draft') void act(() => api.decideDraft(token, false))
  else void act(() => api.skip(token))
}

async function poll(): Promise<void> {
  if (token && !busy) {
    try {
      const next = await api.getState(token)
      if (!busy) apply(next)
    } catch (e) {
      if (e instanceof api.Unauthorized) await signOut()
      else if (!offline) {
        offline = true
        render()
      }
    }
  }
  setTimeout(poll, POLL_MS)
}

async function pairWith(code: string): Promise<void> {
  const error = $('error')
  error.textContent = ''
  try {
    const paired = await api.pair(code)
    token = paired.token
    await bridge.setLocalStorage(TOKEN_KEY, token)
    render()
    apply(await api.getState(token))
  } catch (e) {
    error.textContent = e instanceof Error ? e.message : 'Could not connect.'
  }
}

// ---------- input ----------

// CLICK_EVENT is 0 and zero values are dropped on the wire, so a tap arrives
// with no eventType. The default must be applied per envelope, never globally.
function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

let lastGesture = 0

bridge.onEvenHubEvent(event => {
  const pcm = event.audioEvent?.audioPcm
  if (pcm) {
    onAudio(pcm)
    return
  }

  // The simulator reports gestures on sysEvent, the glasses on textEvent.
  const types = [eventTypeOf(event.sysEvent), eventTypeOf(event.textEvent)]
  const has = (t: OsEventTypeList) => types.includes(t)

  // Required by Even Hub: double-tap on the root page opens the system exit dialog.
  if (has(OsEventTypeList.DOUBLE_CLICK_EVENT)) {
    void bridge.shutDownPageContainer(1)
    return
  }

  if (has(OsEventTypeList.SYSTEM_EXIT_EVENT) || has(OsEventTypeList.ABNORMAL_EXIT_EVENT)) {
    void bridge.audioControl(false)
    return
  }

  if (has(OsEventTypeList.FOREGROUND_ENTER_EVENT)) {
    // Coming back from the background: the microphone was closed for us.
    micOn = false
    syncMic()
    return
  }

  const isTap = has(OsEventTypeList.CLICK_EVENT)
  const isSwipeDown = has(OsEventTypeList.SCROLL_BOTTOM_EVENT)
  if (!isTap && !isSwipeDown) return

  // One physical gesture can be reported more than once.
  const now = Date.now()
  if (now - lastGesture < 400) return
  lastGesture = now

  if (isSwipeDown) secondary()
  else primary()
})

$('pairBtn').addEventListener('click', () => void pairWith($<HTMLInputElement>('code').value))
$('doneBtn').addEventListener('click', primary)
$('skipBtn').addEventListener('click', secondary)
$('endBtn').addEventListener('click', () => void act(() => api.end(token)))
$('micBtn').addEventListener('click', async () => {
  micWanted = !micWanted
  await bridge.setLocalStorage(MIC_KEY, micWanted ? 'on' : 'off')
  syncMic()
  render()
})

// Local testing: http://localhost:5173/?code=123456 pairs without typing.
const urlCode = new URLSearchParams(location.search).get('code')
if (urlCode && !token) await pairWith(urlCode)

render()
void poll()
