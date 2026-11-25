/** Longest question that still reads at a glance on the 576x288 lens. */
export const LENS_CHARS = 140

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + '…'
}

/** Shortens a question for the lens. */
export async function shorten(text: string): Promise<string> {
  return clip(text, LENS_CHARS)
}

/** Turns the host's spoken answer into a short written one. Null when there is nothing worth posting. */
export async function summarise(_question: string, transcript: string): Promise<string | null> {
  const words = transcript.trim().split(/\s+/).filter(Boolean)
  if (words.length < 6) return null
  return clip(transcript, 220)
}
