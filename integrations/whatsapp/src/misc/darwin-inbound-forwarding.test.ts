import axios from 'axios'
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { buildInboundEnvelope, forwardInboundMessage } from './darwin-inbound-forwarding'
import { WhatsAppMessageValue } from './types'

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}))

const isInboundForwardingEnabled = vi.fn()
vi.mock('./feature-toggle', () => ({
  isInboundForwardingEnabled: (...args: unknown[]) => isInboundForwardingEnabled(...args),
}))

const mockedAxiosPost = vi.mocked(axios.post)

const URL = 'https://darwin.example.com/inbound'
const API_KEY = 'secret-api-key'
const PHONE = '5511999999999'
const BSUID = 'bsuid-123'
const NAME = 'Alice'
// 2021-01-01T00:00:00.000Z
const TIMESTAMP = '1609459200'

function buildLogger() {
  const error = vi.fn()
  const logger = { forBot: () => ({ error }) }
  return { logger, error }
}

function buildValue(): WhatsAppMessageValue {
  return {
    messaging_product: 'whatsapp',
    metadata: {
      display_phone_number: '15550001111',
      phone_number_id: 'phone-number-id-1',
    },
  } as WhatsAppMessageValue
}

type AnyMessage = NonNullable<WhatsAppMessageValue['messages']>[number]
type AnyContact = NonNullable<WhatsAppMessageValue['contacts']>[number]

function buildTextMessage(overrides: Partial<Record<string, unknown>> = {}): AnyMessage {
  return {
    from: PHONE,
    id: 'wamid.TEXT',
    timestamp: TIMESTAMP,
    type: 'text',
    text: { body: 'hello world' },
    ...overrides,
  } as AnyMessage
}

function buildImageMessage(): AnyMessage {
  return {
    from: PHONE,
    id: 'wamid.IMAGE',
    timestamp: TIMESTAMP,
    type: 'image',
    image: { id: 'media-1', sha256: 'abc', mime_type: 'image/jpeg', caption: 'a pic' },
  } as AnyMessage
}

function buildContact(overrides: Partial<AnyContact> = {}): AnyContact {
  return {
    wa_id: PHONE,
    user_id: BSUID,
    profile: { name: NAME },
    ...overrides,
  } as AnyContact
}

describe('buildInboundEnvelope', () => {
  test('builds the exact contract shape for a text message', () => {
    const { logger } = buildLogger()
    const message = buildTextMessage({ context: { id: 'wamid.REPLIED' } })

    const envelope = buildInboundEnvelope(message, buildValue(), buildContact(), logger as never)

    expect(envelope).toEqual({
      source: 'whatsapp',
      bot: {
        phoneNumberId: 'phone-number-id-1',
        displayPhoneNumber: '15550001111',
      },
      events: [
        {
          wamid: 'wamid.TEXT',
          occurredAt: '2021-01-01T00:00:00.000Z',
          type: 'text',
          content: { body: 'hello world' },
          text: 'hello world',
          sender: {
            phone: PHONE,
            bsuid: BSUID,
            name: NAME,
          },
          replyToWamid: 'wamid.REPLIED',
        },
      ],
    })
  })

  test('text message: text = message.text.body and content = raw text sub-object', () => {
    const { logger } = buildLogger()
    const envelope = buildInboundEnvelope(buildTextMessage(), buildValue(), buildContact(), logger as never)

    expect(envelope.events[0]!.text).toBe('hello world')
    expect(envelope.events[0]!.content).toEqual({ body: 'hello world' })
  })

  test('non-text message: text is absent and content = raw per-type sub-object', () => {
    const { logger } = buildLogger()
    const message = buildImageMessage()

    const envelope = buildInboundEnvelope(message, buildValue(), buildContact(), logger as never)

    expect(envelope.events[0]!.type).toBe('image')
    expect('text' in envelope.events[0]!).toBe(false)
    expect(envelope.events[0]!.content).toEqual({
      id: 'media-1',
      sha256: 'abc',
      mime_type: 'image/jpeg',
      caption: 'a pic',
    })
  })

  test('sender.name comes from contact.profile?.name; null when absent', () => {
    const { logger } = buildLogger()

    const withName = buildInboundEnvelope(buildTextMessage(), buildValue(), buildContact(), logger as never)
    expect(withName.events[0]!.sender.name).toBe(NAME)

    const noProfile = buildInboundEnvelope(
      buildTextMessage(),
      buildValue(),
      buildContact({ profile: undefined }),
      logger as never
    )
    expect(noProfile.events[0]!.sender.name).toBeNull()
  })

  test('phone and bsuid are null when absent on the contact', () => {
    const { logger } = buildLogger()

    const envelope = buildInboundEnvelope(
      buildTextMessage(),
      buildValue(),
      buildContact({ wa_id: undefined, user_id: undefined }),
      logger as never
    )

    expect(envelope.events[0]!.sender.phone).toBeNull()
    expect(envelope.events[0]!.sender.bsuid).toBeNull()
  })

  test('replyToWamid is the raw Meta wamid from message.context?.id; null when absent', () => {
    const { logger } = buildLogger()

    const noContext = buildInboundEnvelope(buildTextMessage(), buildValue(), buildContact(), logger as never)
    expect(noContext.events[0]!.replyToWamid).toBeNull()

    const withContext = buildInboundEnvelope(
      buildTextMessage({ context: { id: 'wamid.META' } }),
      buildValue(),
      buildContact(),
      logger as never
    )
    expect(withContext.events[0]!.replyToWamid).toBe('wamid.META')
  })

  test('occurredAt is ISO-8601 UTC derived from the epoch-seconds string', () => {
    const { logger } = buildLogger()
    const message = buildTextMessage({ timestamp: '1700000000' })

    const envelope = buildInboundEnvelope(message, buildValue(), buildContact(), logger as never)

    expect(envelope.events[0]!.occurredAt).toBe(new Date(1700000000 * 1000).toISOString())
  })

  test('invalid timestamp: logs a fallback and still produces an envelope', () => {
    const { logger, error } = buildLogger()
    const message = buildTextMessage({ timestamp: 'not-a-number' })

    const envelope = buildInboundEnvelope(message, buildValue(), buildContact(), logger as never)

    expect(error).toHaveBeenCalledTimes(1)
    // A valid ISO-8601 string was still produced (fallback to current time)
    expect(() => new Date(envelope.events[0]!.occurredAt).toISOString()).not.toThrow()
    expect(Number.isNaN(Date.parse(envelope.events[0]!.occurredAt))).toBe(false)
  })
})

describe('forwardInboundMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isInboundForwardingEnabled.mockResolvedValue(true)
    mockedAxiosPost.mockResolvedValue({ status: 200 } as never)
  })

  test('secrets present + gate ON: POSTs once with exact url, envelope, headers and timeout', async () => {
    const { logger } = buildLogger()
    const message = buildTextMessage({ context: { id: 'wamid.REPLIED' } })
    const value = buildValue()
    const contact = buildContact()

    await forwardInboundMessage({
      url: URL,
      apiKey: API_KEY,
      phone: PHONE,
      message,
      value,
      contact,
      logger: logger as never,
    })

    expect(mockedAxiosPost).toHaveBeenCalledTimes(1)
    expect(mockedAxiosPost).toHaveBeenCalledWith(
      URL,
      buildInboundEnvelope(message, value, contact, logger as never),
      {
        headers: {
          'X-API-KEY': API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 3000,
      }
    )
  })

  test('DARWIN_INBOUND_URL missing: no POST and gate is not consulted', async () => {
    const { logger } = buildLogger()

    await forwardInboundMessage({
      url: undefined,
      apiKey: API_KEY,
      phone: PHONE,
      message: buildTextMessage(),
      value: buildValue(),
      contact: buildContact(),
      logger: logger as never,
    })

    expect(mockedAxiosPost).not.toHaveBeenCalled()
    expect(isInboundForwardingEnabled).not.toHaveBeenCalled()
  })

  test('DARWIN_INBOUND_URL empty string: no POST and gate is not consulted', async () => {
    const { logger } = buildLogger()

    await forwardInboundMessage({
      url: '',
      apiKey: API_KEY,
      phone: PHONE,
      message: buildTextMessage(),
      value: buildValue(),
      contact: buildContact(),
      logger: logger as never,
    })

    expect(mockedAxiosPost).not.toHaveBeenCalled()
    expect(isInboundForwardingEnabled).not.toHaveBeenCalled()
  })

  test('DARWIN_API_KEY missing: no POST and gate is not consulted', async () => {
    const { logger } = buildLogger()

    await forwardInboundMessage({
      url: URL,
      apiKey: undefined,
      phone: PHONE,
      message: buildTextMessage(),
      value: buildValue(),
      contact: buildContact(),
      logger: logger as never,
    })

    expect(mockedAxiosPost).not.toHaveBeenCalled()
    expect(isInboundForwardingEnabled).not.toHaveBeenCalled()
  })

  test('secrets present but gate OFF: no POST', async () => {
    const { logger } = buildLogger()
    isInboundForwardingEnabled.mockResolvedValue(false)

    await forwardInboundMessage({
      url: URL,
      apiKey: API_KEY,
      phone: PHONE,
      message: buildTextMessage(),
      value: buildValue(),
      contact: buildContact(),
      logger: logger as never,
    })

    expect(isInboundForwardingEnabled).toHaveBeenCalledWith(PHONE, logger)
    expect(mockedAxiosPost).not.toHaveBeenCalled()
  })

  test('axios.post rejects: does not throw and logs the error once', async () => {
    const { logger, error } = buildLogger()
    mockedAxiosPost.mockRejectedValue(new Error('network down'))

    await expect(
      forwardInboundMessage({
        url: URL,
        apiKey: API_KEY,
        phone: PHONE,
        message: buildTextMessage(),
        value: buildValue(),
        contact: buildContact(),
        logger: logger as never,
      })
    ).resolves.toBeUndefined()

    expect(error).toHaveBeenCalledTimes(1)
  })

  test('called once per message yields one POST per call (fan-out at the loop level)', async () => {
    const { logger } = buildLogger()
    const value = buildValue()

    await forwardInboundMessage({
      url: URL,
      apiKey: API_KEY,
      phone: PHONE,
      message: buildTextMessage({ id: 'wamid.A' }),
      value,
      contact: buildContact(),
      logger: logger as never,
    })
    await forwardInboundMessage({
      url: URL,
      apiKey: API_KEY,
      phone: PHONE,
      message: buildImageMessage(),
      value,
      contact: buildContact(),
      logger: logger as never,
    })

    expect(mockedAxiosPost).toHaveBeenCalledTimes(2)
  })
})
