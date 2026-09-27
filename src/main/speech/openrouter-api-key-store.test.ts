import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const secretStoreMock = vi.hoisted(() => ({
  decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^encrypted:/, '')),
  encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
  isEncryptionAvailable: vi.fn(() => true),
  describeProtectionGap: () => null
}))

let tempHome = ''
const keyPath = (): string => join(tempHome, '.orca', 'openrouter-speech-token.enc')

async function loadStoreModule() {
  vi.resetModules()
  const { setSecretStore } = await import('../../shared/secret-store')
  setSecretStore(secretStoreMock)
  vi.doMock('node:os', async () => {
    const actual = await vi.importActual<typeof Os>('node:os')
    return { ...actual, homedir: () => tempHome }
  })
  return import('./openrouter-api-key-store')
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'orca-openrouter-key-store-'))
  secretStoreMock.decryptString.mockReset()
  secretStoreMock.decryptString.mockImplementation((value) =>
    value.toString('utf8').replace(/^encrypted:/, '')
  )
  secretStoreMock.encryptString.mockClear()
  secretStoreMock.isEncryptionAvailable.mockReset()
  secretStoreMock.isEncryptionAvailable.mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(tempHome, { recursive: true, force: true })
})

describe('OpenRouter speech API key store', () => {
  it('reports missing status without creating storage or touching secret storage', async () => {
    const store = await loadStoreModule()
    expect(store.hasOpenRouterSpeechApiKey()).toBe(false)
    expect(existsSync(join(tempHome, '.orca'))).toBe(false)
    expect(secretStoreMock.isEncryptionAvailable).not.toHaveBeenCalled()
    expect(() => store.readOpenRouterSpeechApiKey()).toThrow('OpenRouter API key is not configured')
  })

  it('checks configured status without decrypting or triggering keychain access', async () => {
    mkdirSync(join(tempHome, '.orca'))
    writeFileSync(keyPath(), 'encrypted:saved-key')
    const store = await loadStoreModule()
    expect(store.hasOpenRouterSpeechApiKey()).toBe(true)
    expect(secretStoreMock.isEncryptionAvailable).not.toHaveBeenCalled()
    expect(secretStoreMock.decryptString).not.toHaveBeenCalled()
  })

  it('encrypts a trimmed key and reuses its cached value after saving', async () => {
    const store = await loadStoreModule()
    store.saveOpenRouterSpeechApiKey('  saved-key \n')
    expect(secretStoreMock.encryptString).toHaveBeenCalledWith('saved-key')
    expect(readFileSync(keyPath(), 'utf8')).toBe('encrypted:saved-key')
    expect(store.readOpenRouterSpeechApiKey()).toBe('saved-key')
    expect(secretStoreMock.decryptString).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')('creates and replaces files with mode 0600', async () => {
    const store = await loadStoreModule()
    store.saveOpenRouterSpeechApiKey('first-key')
    expect(statSync(keyPath()).mode & 0o777).toBe(0o600)
    chmodSync(keyPath(), 0o644)
    store.saveOpenRouterSpeechApiKey('replacement-key')
    expect(statSync(keyPath()).mode & 0o777).toBe(0o600)
    expect(store.readOpenRouterSpeechApiKey()).toBe('replacement-key')
  })

  it('decrypts a persisted key once and caches it for subsequent dictations', async () => {
    const first = await loadStoreModule()
    first.saveOpenRouterSpeechApiKey('saved-key')
    const store = await loadStoreModule()
    expect(store.readOpenRouterSpeechApiKey()).toBe('saved-key')
    expect(store.readOpenRouterSpeechApiKey()).toBe('saved-key')
    expect(secretStoreMock.decryptString).toHaveBeenCalledOnce()
  })

  it('clears the persisted secret and cache independently of the OpenAI key', async () => {
    const store = await loadStoreModule()
    const openAi = await import('./openai-api-key-store')
    openAi.saveOpenAiSpeechApiKey('openai-key')
    store.saveOpenRouterSpeechApiKey('openrouter-key')
    expect(openAi.readOpenAiSpeechApiKey()).toBe('openai-key')
    expect(store.readOpenRouterSpeechApiKey()).toBe('openrouter-key')
    store.clearOpenRouterSpeechApiKey()
    expect(store.hasOpenRouterSpeechApiKey()).toBe(false)
    expect(existsSync(keyPath())).toBe(false)
    expect(() => store.readOpenRouterSpeechApiKey()).toThrow('not configured')
    expect(openAi.hasOpenAiSpeechApiKey()).toBe(true)
    expect(openAi.readOpenAiSpeechApiKey()).toBe('openai-key')
    expect(() => store.clearOpenRouterSpeechApiKey()).not.toThrow()
  })

  it('rejects empty keys without overwriting an existing secret', async () => {
    const store = await loadStoreModule()
    store.saveOpenRouterSpeechApiKey('saved-key')
    expect(() => store.saveOpenRouterSpeechApiKey(' \n ')).toThrow('OpenRouter API key is required')
    expect(store.readOpenRouterSpeechApiKey()).toBe('saved-key')
    expect(readFileSync(keyPath(), 'utf8')).toBe('encrypted:saved-key')
  })

  it('matches the existing plaintext fallback when encryption is unavailable', async () => {
    secretStoreMock.isEncryptionAvailable.mockReturnValue(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = await loadStoreModule()
    store.saveOpenRouterSpeechApiKey('plaintext-key')
    expect(readFileSync(keyPath(), 'utf8')).toBe('plaintext-key')
    expect(secretStoreMock.encryptString).not.toHaveBeenCalled()
    const reloaded = await loadStoreModule()
    expect(reloaded.readOpenRouterSpeechApiKey()).toBe('plaintext-key')
    expect(secretStoreMock.decryptString).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls.flat().join(' ')).not.toContain('plaintext-key')
  })

  it('does not expose secret storage errors or cache failed decryptions', async () => {
    const first = await loadStoreModule()
    first.saveOpenRouterSpeechApiKey('private-key')
    const store = await loadStoreModule()
    secretStoreMock.decryptString.mockImplementationOnce(() => {
      throw new Error('failed to decrypt private-key')
    })
    expect(() => store.readOpenRouterSpeechApiKey()).toThrow(
      'OpenRouter API key could not be decrypted'
    )
    expect(store.readOpenRouterSpeechApiKey()).toBe('private-key')
  })
})
