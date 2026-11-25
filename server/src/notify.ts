import type { Question, Session } from './db.js'

/** Messages the bot posts to the group. Filled in by the Telegram bot module. */
export type Notifier = {
  answered(session: Session, question: Question, summary: string | null): Promise<void>
  skipped(session: Session, question: Question): Promise<void>
  ended(session: Session, answered: number): Promise<void>
}

const silent: Notifier = {
  async answered() {},
  async skipped() {},
  async ended() {},
}

let current: Notifier = silent

export function setNotifier(n: Notifier): void {
  current = n
}

/** A failed group message must never block the host's tap. */
export const notify: Notifier = {
  answered: (s, q, summary) => current.answered(s, q, summary).catch(e => console.error('notify.answered', e)),
  skipped: (s, q) => current.skipped(s, q).catch(e => console.error('notify.skipped', e)),
  ended: (s, n) => current.ended(s, n).catch(e => console.error('notify.ended', e)),
}
