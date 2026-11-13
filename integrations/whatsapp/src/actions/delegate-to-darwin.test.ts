import { describe, test, expect, beforeEach, vi } from 'vitest'

const requestDelegation = vi.fn()
vi.mock('../misc/darwin-handoff', () => ({
  requestDelegation: (...args: unknown[]) => requestDelegation(...args),
  isDelegatedToDarwin: (tags: Record<string, string>) => tags.handoffOwner === 'darwin',
}))
vi.mock('../misc/darwin-forwarding-secrets', () => ({
  getDelegationSecrets: () => ({ url: 'https://darwin.example.com/delegations', apiKey: 'bff-key' }),
}))

import { delegateToDarwin } from './delegate-to-darwin'

function buildProps(getConversation: () => Promise<unknown>, tenant?: string) {
  const error = vi.fn()
  const warn = vi.fn()
  const props = {
    client: { getConversation: vi.fn(getConversation) },
    input: { conversationId: 'conv-1', sectionId: 'handoff-proof', tenant },
    logger: { forBot: () => ({ error, warn }) },
  } as never
  return { props, error, warn }
}

const withTags = (tags: Record<string, string>) => async () => ({ conversation: { tags } })

describe('delegateToDarwin action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('asks Darwin with the secrets, the card inputs and the phone from the conversation tag', async () => {
    requestDelegation.mockResolvedValueOnce(true)
    const { props } = buildProps(withTags({ userPhone: '+5511999999999' }), 'STAY')

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

  test('conversation lookup fails: Darwin is not asked and the real error is logged', async () => {
    const { props, error } = buildProps(async () => {
      throw new Error('conversation not found')
    })

    await expect(delegateToDarwin(props)).resolves.toEqual({ delegated: false })

    expect(requestDelegation).not.toHaveBeenCalled()
    expect(error.mock.calls[0]?.[0]).toContain('conv-1')
    expect(error.mock.calls[0]?.[0]).toContain('conversation not found')
  })

  test('Darwin answer fails but the owner tag is already darwin: reports delegated (bot must wait)', async () => {
    requestDelegation.mockResolvedValueOnce(false)
    const getConversation = vi
      .fn()
      .mockResolvedValueOnce({ conversation: { tags: { userPhone: '+5511999999999' } } })
      .mockResolvedValueOnce({ conversation: { tags: { userPhone: '+5511999999999', handoffOwner: 'darwin' } } })
    const { props, warn } = buildProps(getConversation)

    await expect(delegateToDarwin(props)).resolves.toEqual({ delegated: true })

    expect(warn).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['tag absent', {}],
    ['owner botpress', { handoffOwner: 'botpress' }],
  ])('Darwin says no and the owner tag is not darwin (%s): not delegated', async (_label, tags) => {
    requestDelegation.mockResolvedValueOnce(false)
    const { props, warn } = buildProps(withTags({ userPhone: '+5511999999999', ...tags }))

    await expect(delegateToDarwin(props)).resolves.toEqual({ delegated: false })

    expect(warn).not.toHaveBeenCalled()
  })

  test('re-reading the tag fails: stays not delegated, never throws', async () => {
    requestDelegation.mockResolvedValueOnce(false)
    const getConversation = vi
      .fn()
      .mockResolvedValueOnce({ conversation: { tags: { userPhone: '+5511999999999' } } })
      .mockRejectedValueOnce(new Error('boom'))
    const { props } = buildProps(getConversation)

    await expect(delegateToDarwin(props)).resolves.toEqual({ delegated: false })
  })
})
