import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelManager } from './model-manager'
import { SttService } from './stt-service'

const { readKey, ready } = vi.hoisted(() => ({
  readKey: vi.fn(() => 'openrouter-key'),
  ready: vi.fn(() => true)
}))
vi.mock('./openrouter-api-key-store', () => ({
  hasOpenRouterSpeechApiKey: ready,
  readOpenRouterSpeechApiKey: readKey
}))

let modelsDir: string
beforeEach(() => {
  modelsDir = mkdtempSync(join(tmpdir(), 'orca-openrouter-session-'))
})

afterEach(() => {
  rmSync(modelsDir, { recursive: true, force: true })
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  ready.mockReturnValue(true)
})

describe('OpenRouter dictation lifecycle', () => {
  it('starts without a worker, reads credentials on finish and emits the final transcript', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ text: ' MAI transcript ' }))
    vi.stubGlobal('fetch', fetchMock)
    const service = new SttService(new ModelManager(modelsDir))
    const sink = vi.fn()
    await service.startDictation('openrouter-mai-transcribe-2', sink)
    expect(service.getActiveModelId()).toBe('openrouter-mai-transcribe-2')
    expect(readKey).not.toHaveBeenCalled()
    expect(sink).toHaveBeenCalledWith({ type: 'ready' })
    service.feedAudio(new Float32Array([0.1, 0.2]), 16000)
    await service.stopDictation()
    expect(readKey).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/audio/transcriptions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer openrouter-key' })
      })
    )
    expect(sink.mock.calls.map(([event]) => event)).toEqual([
      { type: 'ready' },
      { type: 'final', text: 'MAI transcript' },
      { type: 'stopped' }
    ])
    expect(service.isActive()).toBe(false)
  })

  it('rejects an unconfigured model before recording', async () => {
    ready.mockReturnValue(false)
    const service = new SttService(new ModelManager(modelsDir))
    await expect(service.startDictation('openrouter-mai-transcribe-2', vi.fn())).rejects.toThrow(
      'Model not ready'
    )
    expect(service.isActive()).toBe(false)
  })

  it('preserves owner isolation and emits a sanitized error followed by stopped', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed openrouter-key')))
    const service = new SttService(new ModelManager(modelsDir))
    const sink = vi.fn()
    await service.startDictation('openrouter-mai-transcribe-2', sink, undefined, 'mobile:1')
    expect(() => service.feedAudio(new Float32Array([0]), 16000, 'desktop')).toThrow(
      'dictation_owner_mismatch'
    )
    await expect(service.stopDictation('desktop')).rejects.toThrow('dictation_owner_mismatch')
    service.feedAudio(new Float32Array([0]), 16000, 'mobile:1')
    await service.stopDictation('mobile:1')
    expect(sink).toHaveBeenCalledWith({ type: 'error', error: 'Failed [redacted]' })
    expect(sink).toHaveBeenLastCalledWith({ type: 'stopped' })
    expect(service.isActive()).toBe(false)
  })

  it('stops an empty recording without sending audio', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const service = new SttService(new ModelManager(modelsDir))
    await service.startDictation('openrouter-mai-transcribe-2', vi.fn())
    await service.stopDictation()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(service.isActive()).toBe(false)
  })
})
