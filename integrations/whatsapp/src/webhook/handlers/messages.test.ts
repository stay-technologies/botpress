import { describe, test, expect, vi } from 'vitest'
import { _handleMessage, _isFlowMessage, HandleMessageArgs } from './messages'
import { WhatsAppMessage } from '../../misc/types'

const baseMessageFields = {
  from: '5511999999999',
  id: 'wamid.TEST',
  timestamp: '1700000000',
} as const

const baseLogger = {
  forBot: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as HandleMessageArgs['logger']

const buildArgs = (message: WhatsAppMessage, createMessageOverride: HandleMessageArgs['createMessageOverride']) =>
  ({
    message,
    conversationId: 'conv-1',
    userId: 'user-1',
    ctx: {} as HandleMessageArgs['ctx'],
    client: {} as HandleMessageArgs['client'],
    logger: baseLogger,
    tags: { id: 'wamid.TEST' },
    createMessageOverride,
  }) satisfies HandleMessageArgs

describe('_handleMessage interactive', () => {
  test('nfm_reply (Stay): mapeia response_json → value e body → text', async () => {
    const createMessage = vi.fn().mockResolvedValue({ message: { id: 'bp-msg-1' } })
    const message: WhatsAppMessage = {
      ...baseMessageFields,
      type: 'interactive',
      interactive: {
        type: 'nfm_reply',
        nfm_reply: {
          response_json: '{"answer":"42"}',
          body: 'Sent',
          name: 'flow',
        },
      },
    }

    await _handleMessage(buildArgs(message, createMessage))

    expect(createMessage).toHaveBeenCalledTimes(1)
    expect(createMessage).toHaveBeenCalledWith({
      type: 'text',
      payload: { value: '{"answer":"42"}', text: 'Sent' },
    })
  })

  test('nfm_reply: não inclui incomingMessageType (diferente de button_reply/list_reply)', async () => {
    const createMessage = vi.fn().mockResolvedValue({ message: { id: 'bp-msg' } })
    const message: WhatsAppMessage = {
      ...baseMessageFields,
      type: 'interactive',
      interactive: {
        type: 'nfm_reply',
        nfm_reply: { response_json: '{}', body: '', name: 'flow' },
      },
    }

    await _handleMessage(buildArgs(message, createMessage))

    expect(createMessage.mock.calls[0]?.[0]).not.toHaveProperty('incomingMessageType')
  })

  test('button_reply: continua emitindo text com value/text e incomingMessageType=interactive (regressão)', async () => {
    const createMessage = vi.fn().mockResolvedValue({ message: { id: 'bp-msg' } })
    const message: WhatsAppMessage = {
      ...baseMessageFields,
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id: 'btn-yes', title: 'Yes' },
      },
    }

    await _handleMessage(buildArgs(message, createMessage))

    expect(createMessage).toHaveBeenCalledWith({
      type: 'text',
      payload: { value: 'btn-yes', text: 'Yes' },
      incomingMessageType: 'interactive',
    })
  })

  test('list_reply: continua emitindo text com value/text e incomingMessageType=interactive (regressão)', async () => {
    const createMessage = vi.fn().mockResolvedValue({ message: { id: 'bp-msg' } })
    const message: WhatsAppMessage = {
      ...baseMessageFields,
      type: 'interactive',
      interactive: {
        type: 'list_reply',
        list_reply: { id: 'item-1', title: 'Option 1', description: 'first' },
      },
    }

    await _handleMessage(buildArgs(message, createMessage))

    expect(createMessage).toHaveBeenCalledWith({
      type: 'text',
      payload: { value: 'item-1', text: 'Option 1' },
      incomingMessageType: 'interactive',
    })
  })
})

describe('_isFlowMessage', () => {
  test('true para nfm_reply com name="flow"', () => {
    const message: WhatsAppMessage = {
      ...baseMessageFields,
      type: 'interactive',
      interactive: {
        type: 'nfm_reply',
        nfm_reply: { response_json: '{}', body: '', name: 'flow' },
      },
    }
    expect(_isFlowMessage(message)).toBe(true)
  })

  test('false para nfm_reply com name diferente de "flow"', () => {
    const message: WhatsAppMessage = {
      ...baseMessageFields,
      type: 'interactive',
      interactive: {
        type: 'nfm_reply',
        nfm_reply: { response_json: '{}', body: '', name: 'other' },
      },
    }
    expect(_isFlowMessage(message)).toBe(false)
  })

  test('false para button_reply', () => {
    const message: WhatsAppMessage = {
      ...baseMessageFields,
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id: 'a', title: 'A' },
      },
    }
    expect(_isFlowMessage(message)).toBe(false)
  })

  test('false para mensagem de texto', () => {
    const message: WhatsAppMessage = {
      ...baseMessageFields,
      type: 'text',
      text: { body: 'oi' },
    }
    expect(_isFlowMessage(message)).toBe(false)
  })
})

describe('_handleMessage text/button (regressão)', () => {
  test('text: encaminha body → payload.text', async () => {
    const createMessage = vi.fn().mockResolvedValue({ message: { id: 'bp-msg' } })
    const message: WhatsAppMessage = {
      ...baseMessageFields,
      type: 'text',
      text: { body: 'hello world' },
    }

    await _handleMessage(buildArgs(message, createMessage))

    expect(createMessage).toHaveBeenCalledWith({
      type: 'text',
      payload: { text: 'hello world' },
    })
  })

  test('button: encaminha payload+text como text com value/text', async () => {
    const createMessage = vi.fn().mockResolvedValue({ message: { id: 'bp-msg' } })
    const message: WhatsAppMessage = {
      ...baseMessageFields,
      type: 'button',
      button: { payload: 'pay-load', text: 'Click me' },
    }

    await _handleMessage(buildArgs(message, createMessage))

    expect(createMessage).toHaveBeenCalledWith({
      type: 'text',
      payload: { value: 'pay-load', text: 'Click me' },
    })
  })
})
