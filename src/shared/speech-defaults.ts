import type { VoiceSettings } from './speech-types'

export function getDefaultVoiceSettings(): VoiceSettings {
  return {
    enabled: false,
    sttModel: '',
    modelsDir: '',
    language: 'en',
    dictationMode: 'toggle' as const,
    terminalConfirmBeforeInsert: false,
    userModels: [],
    openAiApiKeyConfigured: false,
    openRouterApiKeyConfigured: false,
    microphoneDeviceId: null,
    microphoneDeviceLabel: null
  }
}
