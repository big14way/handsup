import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'

/** What the lens shows: a dim line of context, the one thing to read, and the gestures that act on it. */
export type Card = { head: string; body: string; foot: string }

const W = 576
const ROWS = [
  { id: 1, name: 'head', y: 0, h: 40, color: 2, capture: 0 },
  // The body is the only container that takes input, so taps and swipes arrive on it.
  { id: 2, name: 'body', y: 44, h: 196, color: 4, capture: 1 },
  { id: 3, name: 'foot', y: 244, h: 44, color: 2, capture: 0 },
] as const

/**
 * The G2 font has no emoji and draws them as empty outlines, which Telegram
 * names are full of. Drop them and tidy the gaps they leave.
 */
function forLens(text: string): string {
  return (
    text
      .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍️⃣]/gu, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/^ ?· /, '')
      .trim() || ' '
  )
}

export async function createLens(bridge: EvenAppBridge, firstCard: Card) {
  const first: Card = { head: forLens(firstCard.head), body: forLens(firstCard.body), foot: forLens(firstCard.foot) }
  const shown: Record<string, string> = { ...first }

  const page = {
    containerTotalNum: ROWS.length,
    textObject: ROWS.map(
      row =>
        new TextContainerProperty({
          xPosition: 0,
          yPosition: row.y,
          width: W,
          height: row.h,
          borderWidth: 0,
          paddingLength: 6,
          containerID: row.id,
          containerName: row.name,
          content: first[row.name] || ' ',
          textColor: row.color,
          isEventCapture: row.capture,
        }),
    ),
  }

  // The startup page can only be created once per launch. If the WebView
  // reloads while the glasses still hold our page, rebuild it instead.
  const created = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page))
  if (created !== 0) {
    const rebuilt = await bridge.rebuildPageContainer(new RebuildPageContainer(page))
    if (!rebuilt) console.error('could not create the glasses page', created)
  }

  // Writes go over Bluetooth one at a time; only rows that changed are sent.
  let queue: Promise<unknown> = Promise.resolve()

  function show(card: Card): void {
    for (const row of ROWS) {
      const content = forLens(card[row.name] || ' ')
      if (shown[row.name] === content) continue
      shown[row.name] = content
      queue = queue
        .then(() =>
          bridge.textContainerUpgrade(
            new TextContainerUpgrade({ containerID: row.id, containerName: row.name, content, textColor: row.color }),
          ),
        )
        .catch(e => console.error('lens write failed', e))
    }
  }

  return { show }
}
