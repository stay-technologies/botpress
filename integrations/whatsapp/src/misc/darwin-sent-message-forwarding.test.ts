import axios from 'axios'
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { Image, Template, Language, Text } from 'whatsapp-api-js/messages'
import { RawInteractiveMessage } from '../channels/message-types/raw-interactive'
import { buildSentMessageEnvelope, forwardSentMessage, SentMessageParams } from './darwin-inbound-forwarding'

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
const BSUID = 'BR.1234567890'
const WAMID = 'wamid.SENT'
const BOT_PHONE_NUMBER_ID = 'phone-number-id-1'

function buildLogger() {
  const error = vi.fn()
  const logger = { forBot: () => ({ error }) }
  return { logger, error }
}

function buildParams(overrides: Partial<SentMessageParams> = {}): SentMessageParams {
  const { logger } = buildLogger()
  return {
    wamid: WAMID,
    messageType: 'text',
    message: new Text('hello world'),
    recipientPhone: PHONE,
    recipientBsuid: undefined,
    botPhoneNumberId: BOT_PHONE_NUMBER_ID,
    logger: logger as never,
    ...overrides,
  }
}

describe('buildSentMessageEnvelope', () => {
  test('builds an OUTBOUND text event with content matching the Meta per-type sub-object', () => {
    const envelope = buildSentMessageEnvelope(buildParams())

    expect(envelope.source).toBe('whatsapp')
    expect(envelope.bot).toEqual({ phoneNumberId: BOT_PHONE_NUMBER_ID })
    expect(envelope.bot).not.toHaveProperty('displayPhoneNumber')
    expect(envelope.events).toHaveLength(1)

    const event = envelope.events[0]!
    expect(event).toMatchObject({
      wamid: WAMID,
      type: 'text',
      direction: 'OUTBOUND',
      content: { body: 'hello world' },
      text: 'hello world',
      replyToWamid: null,
    })
    expect('content' in event && event.content).not.toHaveProperty('_type')
  })

  test('emits a valid ISO-8601 occurredAt', () => {
    const envelope = buildSentMessageEnvelope(buildParams())
    const event = envelope.events[0]!
    expect('occurredAt' in event && Number.isFinite(Date.parse(event.occurredAt))).toBe(true)
  })

  test('sender carries the recipient phone when only phone is available', () => {
    const envelope = buildSentMessageEnvelope(buildParams({ recipientPhone: PHONE, recipientBsuid: undefined }))
    const event = envelope.events[0]!
    expect('sender' in event && event.sender).toEqual({ phone: PHONE, bsuid: null, name: null })
  })

  test('sender carries the recipient bsuid when only bsuid is available', () => {
    const envelope = buildSentMessageEnvelope(buildParams({ recipientPhone: undefined, recipientBsuid: BSUID }))
    const event = envelope.events[0]!
    expect('sender' in event && event.sender).toEqual({ phone: null, bsuid: BSUID, name: null })
  })

  test('sender carries both identifiers when both are available', () => {
    const envelope = buildSentMessageEnvelope(buildParams({ recipientPhone: PHONE, recipientBsuid: BSUID }))
    const event = envelope.events[0]!
    expect('sender' in event && event.sender).toEqual({ phone: PHONE, bsuid: BSUID, name: null })
  })

  test('builds a media event without a text key', () => {
    const envelope = buildSentMessageEnvelope(
      buildParams({ messageType: 'image', message: new Image('https://cdn.example.com/a.jpg', false, 'caption') })
    )
    const event = envelope.events[0]!
    expect(event).toMatchObject({
      type: 'image',
      direction: 'OUTBOUND',
      content: { link: 'https://cdn.example.com/a.jpg', caption: 'caption' },
    })
    expect(event).not.toHaveProperty('text')
  })

  test('serializes a Template instance to the Meta template payload', () => {
    const envelope = buildSentMessageEnvelope(
      buildParams({ messageType: 'template', message: new Template('my_template', new Language('pt_BR')) })
    )
    const event = envelope.events[0]!
    expect(event).toMatchObject({
      type: 'template',
      content: { name: 'my_template', language: { code: 'pt_BR' } },
    })
    expect(event).not.toHaveProperty('text')
  })

  test('honors toJSON overrides (RawInteractiveMessage serializes to its raw payload)', () => {
    const payload = {
      type: 'cta_url' as const,
      body: { text: 'click here' },
      action: { name: 'cta_url' as const, parameters: { display_text: 'Open', url: 'https://example.com' } },
    }
    const envelope = buildSentMessageEnvelope(
      buildParams({ messageType: 'interactive', message: new RawInteractiveMessage(payload) })
    )
    const event = envelope.events[0]!
    expect('content' in event && event.content).toEqual(payload)
  })

  test('never throws: unserializable message yields null content and logs the error', () => {
    const { logger, error } = buildLogger()
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic

    const envelope = buildSentMessageEnvelope(buildParams({ message: cyclic, logger: logger as never }))

    const event = envelope.events[0]!
    expect('content' in event && event.content).toBeNull()
    expect(event).not.toHaveProperty('text')
    expect(error).toHaveBeenCalledTimes(1)
  })
})

describe('forwardSentMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('skips without consulting the gate when url is missing', async () => {
    await forwardSentMessage({ ...buildParams(), url: undefined, apiKey: API_KEY })
    expect(isInboundForwardingEnabled).not.toHaveBeenCalled()
    expect(mockedAxiosPost).not.toHaveBeenCalled()
  })

  test('skips without consulting the gate when apiKey is missing', async () => {
    await forwardSentMessage({ ...buildParams(), url: URL, apiKey: undefined })
    expect(isInboundForwardingEnabled).not.toHaveBeenCalled()
    expect(mockedAxiosPost).not.toHaveBeenCalled()
  })

  test('skips silently when neither recipient identifier is available', async () => {
    await forwardSentMessage({
      ...buildParams({ recipientPhone: undefined, recipientBsuid: undefined }),
      url: URL,
      apiKey: API_KEY,
    })
    expect(isInboundForwardingEnabled).not.toHaveBeenCalled()
    expect(mockedAxiosPost).not.toHaveBeenCalled()
  })

  test('skips when the gate is off', async () => {
    isInboundForwardingEnabled.mockResolvedValue(false)
    await forwardSentMessage({ ...buildParams(), url: URL, apiKey: API_KEY })
    expect(isInboundForwardingEnabled).toHaveBeenCalledWith(PHONE, expect.anything())
    expect(mockedAxiosPost).not.toHaveBeenCalled()
  })

  test('consults the gate with the phone when both identifiers are available', async () => {
    isInboundForwardingEnabled.mockResolvedValue(true)
    await forwardSentMessage({
      ...buildParams({ recipientPhone: PHONE, recipientBsuid: BSUID }),
      url: URL,
      apiKey: API_KEY,
    })
    expect(isInboundForwardingEnabled).toHaveBeenCalledWith(PHONE, expect.anything())
  })

  test('consults the gate with the bsuid when phone is missing', async () => {
    isInboundForwardingEnabled.mockResolvedValue(true)
    await forwardSentMessage({
      ...buildParams({ recipientPhone: undefined, recipientBsuid: BSUID }),
      url: URL,
      apiKey: API_KEY,
    })
    expect(isInboundForwardingEnabled).toHaveBeenCalledWith(BSUID, expect.anything())
  })

  test('posts the built envelope with the X-API-KEY header when the gate is on', async () => {
    isInboundForwardingEnabled.mockResolvedValue(true)
    mockedAxiosPost.mockResolvedValue({ status: 200 })

    await forwardSentMessage({ ...buildParams(), url: URL, apiKey: API_KEY })

    expect(mockedAxiosPost).toHaveBeenCalledTimes(1)
    const [calledUrl, envelope, config] = mockedAxiosPost.mock.calls[0]!
    expect(calledUrl).toBe(URL)
    expect(envelope).toMatchObject({
      source: 'whatsapp',
      bot: { phoneNumberId: BOT_PHONE_NUMBER_ID },
      events: [
        {
          wamid: WAMID,
          type: 'text',
          direction: 'OUTBOUND',
          content: { body: 'hello world' },
          text: 'hello world',
          sender: { phone: PHONE, bsuid: null, name: null },
          replyToWamid: null,
        },
      ],
    })
    expect(config?.headers).toMatchObject({ 'X-API-KEY': API_KEY })
  })

  test('swallows axios failures and logs them (send path never breaks)', async () => {
    const { logger, error } = buildLogger()
    isInboundForwardingEnabled.mockResolvedValue(true)
    mockedAxiosPost.mockRejectedValue(new Error('connection refused'))

    await expect(
      forwardSentMessage({
        ...buildParams({ logger: logger as never }),
        url: URL,
        apiKey: API_KEY,
      })
    ).resolves.toBeUndefined()

    expect(error).toHaveBeenCalledWith(expect.stringContaining('connection refused'))
  })
})
