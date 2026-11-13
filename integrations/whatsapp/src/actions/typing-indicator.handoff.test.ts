import { describe, test, expect, beforeEach, vi } from 'vitest'

// Handoff (FOU-1287): the injected return message has no wamid — the indicator is skipped, not failed.
const markAsRead = vi.fn(async () => undefined)
const sendMessage = vi.fn(async () => undefined)
vi.mock('../auth', () => ({
  getAuthenticatedWhatsappClient: async () => ({ markAsRead, sendMessage }),
}))

import { startTypingIndicator, stopTypingIndicator } from './typing-indicator'

function buildProps(messageTags: Record<string, string>) {
  const client = {
    getConversation: vi.fn(async () => ({
      conversation: { tags: { botPhoneNumberId: 'pn-1', userPhone: '+5511999999999' } },
    })),
    getMessage: vi.fn(async () => ({ message: { tags: messageTags } })),
  }
  return {
    client,
    ctx: { configuration: { messageReadBehavior: 'typing_indicator', typingIndicatorEmoji: true } },
    input: { conversationId: 'conv-1', messageId: 'msg-1' },
    logger: { forBot: () => ({ error: vi.fn() }) },
  } as never
}

describe('typing indicator on the handoff return message', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('injected return message: start and stop do nothing on WhatsApp and do not throw', async () => {
    await expect(startTypingIndicator(buildProps({ handoffReturn: 'true' }))).resolves.toEqual({})
    await expect(stopTypingIndicator(buildProps({ handoffReturn: 'true' }))).resolves.toEqual({})

    expect(markAsRead).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  test('regular message keeps the indicator (regression)', async () => {
    await startTypingIndicator(buildProps({ id: 'wamid.X' }))

    expect(markAsRead).toHaveBeenCalledWith('pn-1', 'wamid.X', 'text')
  })

  test('message without wamid and without the handoff tag still fails as before (regression)', async () => {
    await expect(startTypingIndicator(buildProps({}))).rejects.toThrow('Missing WhatsApp message id')
  })
})
