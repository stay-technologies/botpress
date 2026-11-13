import { describe, test, expect, beforeEach, vi } from 'vitest'
import { WhatsAppMessageValue } from '../../misc/types'

// Handoff (FOU-1287): messagesHandler diverts a conversation owned by Darwin and keeps every other one unchanged.
const markAsRead = vi.fn()
vi.mock('../../auth', () => ({
  getAuthenticatedWhatsappClient: async () => ({ markAsRead }),
  getAccessToken: vi.fn(),
}))
vi.mock('.botpress', () => ({
  secrets: { DARWIN_INBOUND_URL: 'https://darwin.example.com/inbound', DARWIN_API_KEY: 'darwin-key', POSTHOG_KEY: 'x' },
}))
vi.mock('../../misc/darwin-forwarding-secrets', () => ({
  getDarwinForwardingSecrets: () => ({ url: 'https://darwin.example.com/inbound', apiKey: 'darwin-key' }),
}))
const forwardInboundMessage = vi.fn()
const forwardDelegatedInboundMessage = vi.fn()
vi.mock('../../misc/darwin-inbound-forwarding', () => ({
  forwardInboundMessage: (...args: unknown[]) => forwardInboundMessage(...args),
  forwardDelegatedInboundMessage: (...args: unknown[]) => forwardDelegatedInboundMessage(...args),
}))

import { messagesHandler } from './messages'

const message = { from: '5511999999999', id: 'wamid.TEST', timestamp: '1700000000', type: 'text', text: { body: 'oi' } }
const contact = { wa_id: '5511999999999', profile: { name: 'Alice' } }
const value = {
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: '15550001111', phone_number_id: 'pn-1' },
  contacts: [contact],
} as unknown as WhatsAppMessageValue

function buildProps(conversationTags: Record<string, string>) {
  const client = {
    getOrCreateConversation: vi.fn(async () => ({ conversation: { id: 'conv-1', tags: conversationTags } })),
    getOrCreateUser: vi.fn(async () => ({ user: { id: 'user-1' } })),
    getOrCreateMessage: vi.fn(async () => ({ message: { id: 'bp-msg-1' } })),
  }
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const logger = { ...log, forBot: () => log }
  return { client, props: { ctx: { configuration: {} }, client, logger } as never }
}

describe('messagesHandler handoff diversion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('handoffOwner = darwin: marks as read, forwards to Darwin and the bot never sees the message', async () => {
    const { client, props } = buildProps({ handoffOwner: 'darwin' })

    await messagesHandler(message as never, value, props)

    expect(markAsRead).toHaveBeenCalledWith('pn-1', 'wamid.TEST')
    expect(markAsRead.mock.invocationCallOrder[0]).toBeLessThan(
      forwardDelegatedInboundMessage.mock.invocationCallOrder[0]!
    )
    expect(forwardDelegatedInboundMessage).toHaveBeenCalledTimes(1)
    expect(forwardDelegatedInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://darwin.example.com/inbound',
        apiKey: 'darwin-key',
        message,
        value,
        contact,
      })
    )
    expect(client.getOrCreateMessage).not.toHaveBeenCalled()
    expect(client.getOrCreateUser).not.toHaveBeenCalled()
    expect(forwardInboundMessage).not.toHaveBeenCalled()
  })

  test.each([
    ['tag absent', {}],
    ['handoffOwner = botpress', { handoffOwner: 'botpress' }],
    ['any other value', { handoffOwner: 'DARWIN' }],
  ])('%s: delivered to the bot exactly as before (best-effort gated forwarding)', async (_label, tags) => {
    const { client, props } = buildProps(tags as Record<string, string>)

    await messagesHandler(message as never, value, props)

    expect(markAsRead).toHaveBeenCalledWith('pn-1', 'wamid.TEST')
    expect(client.getOrCreateMessage).toHaveBeenCalledTimes(1)
    expect(client.getOrCreateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'text', payload: { text: 'oi' }, conversationId: 'conv-1', userId: 'user-1' })
    )
    expect(forwardInboundMessage).toHaveBeenCalledTimes(1)
    expect(forwardInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '5511999999999', message, value, contact })
    )
    expect(forwardDelegatedInboundMessage).not.toHaveBeenCalled()
  })
})
