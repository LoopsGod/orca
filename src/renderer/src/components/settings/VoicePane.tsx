import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { getDefaultVoiceSettings } from '../../../../shared/constants'
import type { SpeechModelManifest, VoiceSettings } from '../../../../shared/speech-types'
import { Separator } from '../ui/separator'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { CloudTranscriptionKeyDialog } from './CloudTranscriptionKeyDialog'
import { CloudTranscriptionSettingsRow } from './CloudTranscriptionSettingsRow'
import { handleVoiceDictationToggle } from './voice-dictation-toggle'
import { VoiceDictationSettingsSection } from './VoiceDictationSettingsSection'
import { VoiceSpeechModelSection } from './VoiceSpeechModelSection'
import { useCloudTranscriptionKey } from './use-cloud-transcription-key'
import { translate } from '@/i18n/i18n'

export { handleVoiceDictationToggle }

type VoicePaneProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function VoicePane({ settings, updateSettings }: VoicePaneProps): React.JSX.Element {
  // Why: a stable fallback prevents the fetch effect from repeating on every parent render.
  const [defaultVoiceSettings] = useState(getDefaultVoiceSettings)
  const voiceSettings = settings.voice ?? defaultVoiceSettings
  const modelStates = useAppStore((s) => s.modelStates)
  const refreshModelStates = useAppStore((s) => s.refreshModelStates)
  const markFeatureTipsSeen = useAppStore((s) => s.markFeatureTipsSeen)
  const [catalog, setCatalog] = useState<SpeechModelManifest[]>([])
  const [permissionPending, setPermissionPending] = useState(false)
  const mountedRef = useRef(true)
  // Why: every write here is a read-modify-write of the whole voice object, and the
  // writers are async (key status probe, save/clear key). Merging onto the render-time
  // snapshot would resurrect settings that changed while the IPC was in flight — e.g.
  // reverting `enabled` to false and leaving the microphone picker permanently disabled.
  // Written in an effect, not during render: the async writers all run post-commit.
  const voiceSettingsRef = useRef(voiceSettings)
  useEffect(() => {
    voiceSettingsRef.current = voiceSettings
  }, [voiceSettings])

  const handlePaneRef = useCallback((node: HTMLDivElement | null): void => {
    mountedRef.current = node !== null
  }, [])

  const updateVoiceSettings = useCallback(
    (updates: Partial<VoiceSettings>): void => {
      voiceSettingsRef.current = { ...voiceSettingsRef.current, ...updates }
      updateSettings({ voice: voiceSettingsRef.current })
    },
    [updateSettings]
  )

  useEffect(() => {
    let cancelled = false
    refreshModelStates()
    void window.api.speech
      .getCatalog()
      .then((nextCatalog) => {
        if (!cancelled) {
          setCatalog(nextCatalog)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [refreshModelStates])

  useEffect(() => {
    const cleanup = window.api.speech.onDownloadProgress(() => {
      refreshModelStates()
    })
    return cleanup
  }, [refreshModelStates])

  const toggleVoiceDictation = async (): Promise<void> => {
    await handleVoiceDictationToggle({
      voiceEnabled: voiceSettings.enabled,
      markFeatureTipsSeen,
      updateVoiceSettings,
      requestMicrophonePermission: () =>
        window.api.developerPermissions.request({ id: 'microphone' }),
      setPermissionPending,
      isMounted: () => mountedRef.current,
      notifyPermissionGranted: () =>
        toast.success(
          translate(
            'auto.components.settings.VoicePane.cd9fe37556',
            'Microphone permission granted'
          )
        ),
      notifyPermissionOpenedSystemSettings: () =>
        toast.message(
          translate(
            'auto.components.settings.VoicePane.1eac933202',
            'Opened macOS Privacy & Security. Enable dictation again after granting access.'
          )
        ),
      notifyPermissionRequired: () =>
        toast.message(
          translate(
            'auto.components.settings.VoicePane.f9a9cf6928',
            'Microphone permission is required before enabling voice dictation.'
          )
        ),
      notifyPermissionRequestFailed: () =>
        toast.error(
          translate(
            'auto.components.settings.VoicePane.ad5d036ecc',
            'Could not request microphone permission. Voice dictation was not enabled.'
          )
        )
    })
  }

  const keyOptions = {
    catalog,
    voiceSettingsRef,
    mountedRef,
    updateVoiceSettings,
    refreshModelStates
  }
  const openAiKey = useCloudTranscriptionKey({
    ...keyOptions,
    provider: 'openai',
    configured: voiceSettings.openAiApiKeyConfigured
  })
  const openRouterKey = useCloudTranscriptionKey({
    ...keyOptions,
    provider: 'openrouter',
    configured: voiceSettings.openRouterApiKeyConfigured
  })

  return (
    <div ref={handlePaneRef} className="space-y-1">
      <VoiceDictationSettingsSection
        voiceSettings={voiceSettings}
        permissionPending={permissionPending}
        onToggleVoiceDictation={() => void toggleVoiceDictation()}
        onUpdateVoiceSettings={updateVoiceSettings}
      />

      <VoiceSpeechModelSection
        voiceSettings={voiceSettings}
        catalog={catalog}
        modelStates={modelStates}
        onUpdateVoiceSettings={updateVoiceSettings}
        onOpenCloudDialog={(provider, modelId) => {
          const key = provider === 'openai' ? openAiKey : openRouterKey
          key.openDialog(modelId)
        }}
        onRefreshModelStates={refreshModelStates}
      />

      {[openAiKey, openRouterKey].map((key) => (
        <Fragment key={key.provider}>
          <Separator />
          <CloudTranscriptionSettingsRow
            provider={key.provider}
            configured={key.configured}
            disabled={key.pending}
            onConfigure={() => key.openDialog()}
            onClear={key.onClear}
          />
          <CloudTranscriptionKeyDialog {...key} />
        </Fragment>
      ))}
    </div>
  )
}
