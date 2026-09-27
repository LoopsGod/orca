import { describe, expect, it, vi } from 'vitest'
import { SPEECH_OPENROUTER_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { RuntimeSpeechSetupState } from '../../../../shared/runtime-worktree-contracts'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { SPEECH_METHODS } from './speech'

const setup: RuntimeSpeechSetupState = {
  enabled: true,
  selectedModelId: 'openrouter-mai-transcribe-2',
  dictationMode: 'toggle',
  models: [
    {
      id: 'local',
      label: 'Local',
      provider: 'local',
      sizeBytes: 100,
      recommended: true,
      status: 'ready',
      progress: null
    },
    {
      id: 'openai',
      label: 'OpenAI',
      provider: 'openai',
      sizeBytes: null,
      recommended: false,
      status: 'ready',
      progress: null
    },
    {
      id: 'openrouter-mai-transcribe-2',
      label: 'MAI',
      provider: 'openrouter',
      sizeBytes: null,
      recommended: false,
      status: 'ready',
      progress: null
    }
  ]
}

function makeDispatcher(): RpcDispatcher {
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    listMobileSpeechModels: vi.fn().mockResolvedValue(setup),
    deleteMobileSpeechModel: vi.fn().mockResolvedValue(setup),
    configureMobileDictation: vi.fn().mockResolvedValue(setup)
  }
  return new RpcDispatcher({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: These methods exercise only the four runtime members stubbed above.
    runtime: runtime as unknown as OrcaRuntimeService,
    methods: SPEECH_METHODS
  })
}

describe('speech catalog capability', () => {
  it.each([
    ['speech.models.list', null],
    ['speech.models.delete', { modelId: 'local' }],
    ['speech.dictation.setup', { enabled: true }]
  ])('projects every %s reply for old and current clients', async (method, params) => {
    const dispatcher = makeDispatcher()
    const request = { id: 'request', authToken: 'token', method, params }
    for (const clientKind of ['mobile', 'runtime'] as const) {
      for (const clientCapabilities of [undefined, [], [SPEECH_OPENROUTER_RUNTIME_CAPABILITY]]) {
        const response = await dispatcher.dispatch(request, { clientKind, clientCapabilities })
        expect(response).toMatchObject({
          ok: true,
          result: {
            ...setup,
            models: clientCapabilities?.length ? setup.models : setup.models.slice(0, 2)
          }
        })
      }
    }
    expect(await dispatcher.dispatch(request)).toMatchObject({ ok: true, result: setup })
    expect(setup.models).toHaveLength(3)
  })
})
