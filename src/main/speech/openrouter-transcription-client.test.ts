import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenRouterTranscriptionSession } from './openrouter-transcription-client'

const modelId = 'openrouter-mai-transcribe-2'
const apiKey = 'sk-or-v1-private-key'

function session(): OpenRouterTranscriptionSession {
  const session = new OpenRouterTranscriptionSession(modelId, () => apiKey)
  session.feedAudio(new Float32Array([0, 1, -1]), 16000)
  return session
}

afterEach(() => vi.unstubAllGlobals())

describe('OpenRouterTranscriptionSession', () => {
  it('sends MAI a base64 PCM16 WAV with Bearer authentication and returns trimmed text', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ text: '  Hello world \n' }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await session().finish()).toBe('Hello world')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/audio/transcriptions')
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://onorca.dev',
        'X-OpenRouter-Title': 'Orca'
      }
    })
    if (typeof init?.body !== 'string') {
      throw new Error('Expected JSON body')
    }
    const body = JSON.parse(init.body)
    expect(body.model).toBe('microsoft/mai-transcribe-2')
    expect(body.input_audio.format).toBe('wav')
    const wav = Buffer.from(body.input_audio.data, 'base64')
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.readUInt16LE(20)).toBe(1)
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt32LE(24)).toBe(16000)
    expect(wav.readUInt16LE(34)).toBe(16)
    expect(wav.readUInt32LE(40)).toBe(6)
    expect([wav.readInt16LE(44), wav.readInt16LE(46), wav.readInt16LE(48)]).toEqual([
      0, 32767, -32768
    ])
  })

  it('does not read credentials or fetch for an empty session', async () => {
    const readKey = vi.fn()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await new OpenRouterTranscriptionSession(modelId, readKey).finish()).toBe('')
    expect(readKey).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [401, { error: { message: `Invalid ${apiKey}` } }, 'Invalid [redacted]'],
    [200, { error: { message: 'Quota exceeded' }, text: 'ignore' }, 'Quota exceeded'],
    [200, { error: 'Provider unavailable' }, 'Provider unavailable'],
    [200, { error: {} }, 'OpenRouter returned a transcription error'],
    [403, {}, 'Check your OpenRouter API key'],
    [429, {}, 'HTTP 429'],
    [200, {}, 'did not include text'],
    [200, null, 'did not include text'],
    [200, { text: 42 }, 'did not include text']
  ])('handles response status %s and body %j', async (status, body, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body, { status })))
    await expect(session().finish()).rejects.toThrow(message)
  })

  it('handles malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('invalid json')))
    await expect(session().finish()).rejects.toThrow('did not include text')
  })

  it('redacts actual keys, token patterns, and authorization from network errors', async () => {
    const secret = 'nonstandard-secret'
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValue(
          new Error(`Failed ${secret} sk-or-v1-other-key Authorization: Bearer another-token`)
        )
    )
    const recording = new OpenRouterTranscriptionSession(modelId, () => secret)
    recording.feedAudio(new Float32Array([0]), 16000)
    await expect(recording.finish()).rejects.toThrow(
      'Failed [redacted] [redacted] Authorization: Bearer [redacted]'
    )
  })

  it('rejects unknown model ids before sending audio', async () => {
    const recording = new OpenRouterTranscriptionSession('unknown', () => apiKey)
    recording.feedAudio(new Float32Array([0]), 16000)
    await expect(recording.finish()).rejects.toThrow('Unknown OpenRouter transcription model')
  })
})
