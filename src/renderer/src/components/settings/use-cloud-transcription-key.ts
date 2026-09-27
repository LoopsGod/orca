import { useEffect, useState, type RefObject } from 'react'
import { toast } from 'sonner'
import type { SpeechModelManifest, VoiceSettings } from '../../../../shared/speech-types'
import { translate } from '@/i18n/i18n'
import {
  cloudTranscriptionConfiguredUpdate,
  getCloudTranscriptionKeyApi,
  getCloudTranscriptionProviderLabel,
  type CloudTranscriptionProvider
} from './cloud-transcription-provider'

type CloudTranscriptionKeyOptions = {
  provider: CloudTranscriptionProvider
  configured: boolean
  catalog: SpeechModelManifest[]
  voiceSettingsRef: RefObject<VoiceSettings>
  mountedRef: RefObject<boolean>
  updateVoiceSettings: (updates: Partial<VoiceSettings>) => void
  refreshModelStates: () => void | Promise<void>
}

export function useCloudTranscriptionKey({
  provider,
  configured,
  catalog,
  voiceSettingsRef,
  mountedRef,
  updateVoiceSettings,
  refreshModelStates
}: CloudTranscriptionKeyOptions) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [pendingModelId, setPendingModelId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getCloudTranscriptionKeyApi(provider)
      .getStatus()
      .then((status) => {
        if (!cancelled && status.configured !== configured) {
          updateVoiceSettings(cloudTranscriptionConfiguredUpdate(provider, status.configured))
          void refreshModelStates()
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [provider, configured, voiceSettingsRef, updateVoiceSettings, refreshModelStates])

  const openDialog = (modelId: string | null = null): void => {
    setPendingModelId(modelId)
    setApiKeyDraft('')
    setDialogOpen(true)
  }

  const onOpenChange = (open: boolean): void => {
    setDialogOpen(open)
    if (!open) {
      setApiKeyDraft('')
      setPendingModelId(null)
    }
  }

  const changeKey = async (operation: 'save' | 'clear'): Promise<void> => {
    if (pending) {
      return
    }
    setPending(true)
    const api = getCloudTranscriptionKeyApi(provider)
    const providerLabel = getCloudTranscriptionProviderLabel(provider)
    try {
      await (operation === 'save' ? api.save(apiKeyDraft) : api.clear())
      const currentModelId = voiceSettingsRef.current.sttModel
      const clearSelectedModel =
        operation === 'clear' &&
        catalog.some((model) => model.id === currentModelId && model.provider === provider)
      updateVoiceSettings({
        ...cloudTranscriptionConfiguredUpdate(provider, operation === 'save'),
        ...(clearSelectedModel
          ? { sttModel: '' }
          : operation === 'save' && pendingModelId
            ? { sttModel: pendingModelId }
            : {})
      })
      await refreshModelStates()
      onOpenChange(false)
      toast.success(
        operation === 'save'
          ? translate('settings.voice.cloudKeySaved', '{{provider}} API key saved', {
              provider: providerLabel
            })
          : translate('settings.voice.cloudKeyCleared', '{{provider}} API key cleared', {
              provider: providerLabel
            })
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate('settings.voice.cloudKeyFailed', 'Failed to update {{provider}} API key', {
              provider: providerLabel
            })
      )
    } finally {
      if (mountedRef.current) {
        setPending(false)
      }
    }
  }

  return {
    provider,
    configured,
    open: dialogOpen,
    apiKeyDraft,
    pending,
    openDialog,
    onOpenChange,
    onApiKeyDraftChange: setApiKeyDraft,
    onSave: () => void changeKey('save'),
    onClear: () => void changeKey('clear')
  }
}
