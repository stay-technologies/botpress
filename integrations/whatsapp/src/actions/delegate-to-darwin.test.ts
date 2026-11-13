import { describe, test, expect, beforeEach, vi } from 'vitest'

const requestDelegation = vi.fn()
vi.mock('../misc/darwin-handoff', () => ({
  requestDelegation: (...args: unknown[]) => requestDelegation(...args),
}))
vi.mock('../misc/darwin-forwarding-secrets', () => ({
  getDelegationSecrets: () => ({ url: 'https://darwin.example.com/delegations', apiKey: 'bff-key' }),
}))

import { delegateToDarwin } from './delegate-to-darwin'

function buildProps(getConversation: () => Promise<unknown>, tenant?: string) {
  return {
    client: { getConversation: vi.fn(getConversation) },
    input: { conversationId: 'conv-1', sectionId: 'handoff-proof', tenant },
    logger: {},
  } as never
}

describe('delegateToDarwin action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('asks Darwin with the secrets, the card inputs and the phone from the conversation tag', async () => {
    requestDelegation.mockResolvedValueOnce(true)
    const props = buildProps(async () => ({ conversation: { tags: { userPhone: '+5511999999999' } } }), 'STAY')

    await expect(delegateToDarwin(props)).resolves.toEqual({ delegated: true })

    expect(requestDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://darwin.example.com/delegations',
        apiKey: 'bff-key',
        tenant: 'STAY',
        conversationId: 'conv-1',
        sectionId: 'handoff-proof',
        phoneNumber: '+5511999999999',
      })
    )
  })

  test('conversation lookup fails: does not throw, phone goes undefined and the result is not delegated', async () => {
    requestDelegation.mockResolvedValueOnce(false)
    const props = buildProps(async () => {
      throw new Error('not found')
    })

    await expect(delegateToDarwin(props)).resolves.toEqual({ delegated: false })

    expect(requestDelegation).toHaveBeenCalledWith(expect.objectContaining({ phoneNumber: undefined }))
  })
})
