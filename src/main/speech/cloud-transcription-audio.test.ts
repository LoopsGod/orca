import { describe, expect, it } from 'vitest'
import { CloudTranscriptionAudio } from './cloud-transcription-audio'

describe('CloudTranscriptionAudio', () => {
  it('resamples to 16 kHz, copies incoming chunks and combines them in order', () => {
    const audio = new CloudTranscriptionAudio()
    const samples = new Float32Array([0.5, 0.5, 0.5, -0.5, -0.5, -0.5])
    audio.feedAudio(samples, 48000)
    samples.fill(0)
    audio.feedAudio(new Float32Array([2, -2]), 16000)
    const wav = audio.takeWav()
    expect(wav?.readUInt32LE(24)).toBe(16000)
    expect(wav?.readUInt32LE(40)).toBe(8)
    expect(wav?.readInt16LE(44)).toBe(16384)
    expect(wav?.readInt16LE(46)).toBe(-16384)
    expect(wav?.readInt16LE(48)).toBe(32767)
    expect(wav?.readInt16LE(50)).toBe(-32768)
    expect(audio.takeWav()).toBeNull()
  })

  it('limits cumulative recording duration to ten minutes', () => {
    const audio = new CloudTranscriptionAudio()
    audio.feedAudio(new Float32Array(16000 * 600), 16000)
    expect(() => audio.feedAudio(new Float32Array(1), 16000)).toThrow('limited to 10 minutes')
  })
})
