// @vitest-environment happy-dom

import { useCallback, useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings, getDefaultVoiceSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { SpeechModelManifest } from '../../../../shared/speech-types'

const catalog: SpeechModelManifest[] = [
  {
    id: 'openrouter-mai-transcribe-2',
    label: 'MAI-Transcribe 2',
    description: 'Microsoft multilingual transcription',
    provider: 'openrouter',
    type: 'openrouter',
    language: 'multilingual',
    sampleRate: 16000,
    streaming: false
  }
]
import { VoicePane } from './VoicePane'
import { TooltipProvider } from '../ui/tooltip'

const { refreshModelStates, settingsChanged } = vi.hoisted(() => ({
  refreshModelStates: vi.fn(),
  settingsChanged: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ modelStates: [], refreshModelStates, markFeatureTipsSeen: vi.fn() })
}))
vi.mock('./VoiceDictationSettingsSection', () => ({
  VoiceDictationSettingsSection: () => null
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function StatefulVoicePane({ modelId = '' }: { modelId?: string }): React.JSX.Element {
  const [settings, setSettings] = useState<GlobalSettings>(() => ({
    ...getDefaultSettings('/tmp/orca-speech-test'),
    voice: {
      ...getDefaultVoiceSettings(),
      enabled: true,
      openAiApiKeyConfigured: true,
      sttModel: modelId
    }
  }))
  const updateSettings = useCallback((updates: Partial<GlobalSettings>) => {
    settingsChanged(updates)
    setSettings((current) => ({ ...current, ...updates }))
  }, [])
  return (
    <TooltipProvider>
      <VoicePane settings={settings} updateSettings={updateSettings} />
    </TooltipProvider>
  )
}

describe('Voice cloud transcription keys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    let openRouterConfigured = false
    Object.assign(window, {
      api: {
        speech: {
          getCatalog: vi.fn(async () => catalog),
          getOpenAiApiKeyStatus: vi.fn(async () => ({ configured: true })),
          saveOpenAiApiKey: vi.fn(),
          clearOpenAiApiKey: vi.fn(),
          getOpenRouterApiKeyStatus: vi.fn(async () => ({ configured: openRouterConfigured })),
          saveOpenRouterApiKey: vi.fn(async () => {
            openRouterConfigured = true
            return { configured: true }
          }),
          clearOpenRouterApiKey: vi.fn(async () => {
            openRouterConfigured = false
            return { configured: false }
          }),
          onDownloadProgress: vi.fn(() => () => {})
        }
      }
    })
  })

  afterEach(cleanup)

  it.each(['Escape', 'Close'])('keeps pending key setup open on %s', async (dismiss) => {
    let finishSave: (status: { configured: boolean }) => void = () => {}
    window.api.speech.saveOpenRouterApiKey = vi.fn(
      () => new Promise<{ configured: boolean }>((resolve) => (finishSave = resolve))
    )
    render(<StatefulVoicePane />)
    fireEvent.click(screen.getByRole('button', { name: 'Add API key' }))
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-or-pending' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Key' }))
    if (dismiss === 'Escape') {
      fireEvent.keyDown(document, { key: 'Escape' })
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    }
    expect(screen.getByRole('dialog')).toBeTruthy()
    window.api.speech.getOpenRouterApiKeyStatus = vi.fn(async () => ({ configured: true }))
    finishSave({ configured: true })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('adds, replaces and disconnects the OpenRouter key independently of OpenAI', async () => {
    render(<StatefulVoicePane modelId="openai-gpt-4o-transcribe" />)
    fireEvent.click(screen.getByRole('button', { name: 'Add API key' }))
    const input = screen.getByLabelText<HTMLInputElement>('API Key')
    expect(input.type).toBe('password')
    expect(
      screen.getByText(
        'Audio is sent to OpenRouter only when an OpenRouter speech model is selected.'
      )
    ).toBeTruthy()
    fireEvent.change(input, { target: { value: 'sk-or-first' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Key' }))
    await waitFor(() =>
      expect(window.api.speech.saveOpenRouterApiKey).toHaveBeenCalledWith('sk-or-first')
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(settingsChanged).toHaveBeenLastCalledWith({
      voice: expect.objectContaining({
        openAiApiKeyConfigured: true,
        openRouterApiKeyConfigured: true,
        sttModel: 'openai-gpt-4o-transcribe'
      })
    })
    const replaceButtons = screen.getAllByRole('button', { name: 'Replace key' })
    fireEvent.click(replaceButtons[1])
    const replacement = screen.getByLabelText<HTMLInputElement>('API Key')
    expect(replacement.value).toBe('')
    fireEvent.change(replacement, { target: { value: 'sk-or-replacement' } })
    fireEvent.keyDown(replacement, { key: 'Enter' })
    await waitFor(() =>
      expect(window.api.speech.saveOpenRouterApiKey).toHaveBeenLastCalledWith('sk-or-replacement')
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect OpenRouter API key' }))
    await waitFor(() => expect(window.api.speech.clearOpenRouterApiKey).toHaveBeenCalledOnce())
    expect(settingsChanged).toHaveBeenLastCalledWith({
      voice: expect.objectContaining({
        openAiApiKeyConfigured: true,
        openRouterApiKeyConfigured: false,
        sttModel: 'openai-gpt-4o-transcribe'
      })
    })
    expect(window.api.speech.saveOpenAiApiKey).not.toHaveBeenCalled()
    expect(window.api.speech.clearOpenAiApiKey).not.toHaveBeenCalled()
  })

  it('clears the selected MAI model when disconnecting OpenRouter', async () => {
    window.api.speech.getOpenRouterApiKeyStatus = vi.fn(async () => ({ configured: true }))
    render(<StatefulVoicePane modelId="openrouter-mai-transcribe-2" />)
    const disconnect = await screen.findByRole('button', { name: 'Disconnect OpenRouter API key' })
    window.api.speech.getOpenRouterApiKeyStatus = vi.fn(async () => ({ configured: false }))
    fireEvent.click(disconnect)
    await waitFor(() =>
      expect(settingsChanged).toHaveBeenLastCalledWith({
        voice: expect.objectContaining({
          sttModel: '',
          openAiApiKeyConfigured: true,
          openRouterApiKeyConfigured: false
        })
      })
    )
  })
})
