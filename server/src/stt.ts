/** Wraps raw 16 kHz mono 16-bit PCM (what the glasses send) in a WAV header. */
function pcmToWav(pcm: Uint8Array): Uint8Array {
  const header = new DataView(new ArrayBuffer(44))
  const ascii = (offset: number, s: string) => [...s].forEach((ch, i) => header.setUint8(offset + i, ch.charCodeAt(0)))
  const rate = 16_000
  ascii(0, 'RIFF')
  header.setUint32(4, 36 + pcm.length, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true) // PCM
  header.setUint16(22, 1, true) // mono
  header.setUint32(24, rate, true)
  header.setUint32(28, rate * 2, true)
  header.setUint16(32, 2, true)
  header.setUint16(34, 16, true)
  ascii(36, 'data')
  header.setUint32(40, pcm.length, true)
  const wav = new Uint8Array(44 + pcm.length)
  wav.set(new Uint8Array(header.buffer), 0)
  wav.set(pcm, 44)
  return wav
}

/** True when the clip is close to silence, so it is not worth a transcription call. */
function isQuiet(pcm: Uint8Array): boolean {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2))
  let sum = 0
  for (let i = 0; i < samples.length; i += 8) sum += Math.abs(samples[i])
  return sum / Math.max(1, samples.length / 8) < 120
}

export const sttConfigured = () => Boolean(process.env.GROQ_API_KEY)

/** Transcribes a chunk of the host's speech. Returns '' when there is nothing usable. */
export async function transcribe(pcm: Uint8Array): Promise<string> {
  const key = process.env.GROQ_API_KEY
  if (!key || pcm.length < 16_000 || isQuiet(pcm)) return ''
  const form = new FormData()
  form.append('file', new Blob([pcmToWav(pcm) as BlobPart], { type: 'audio/wav' }), 'answer.wav')
  form.append('model', 'whisper-large-v3-turbo')
  form.append('response_format', 'json')
  form.append('temperature', '0')
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`transcription failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { text?: string }
  return (data.text ?? '').trim()
}
