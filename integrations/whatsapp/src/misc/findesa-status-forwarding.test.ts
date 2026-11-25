import axios from 'axios'
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { buildFindesaStatuses, forwardStatusesToFindesa } from './findesa-status-forwarding'
import { WhatsAppPayloadSchema, WhatsAppStatusValue } from './types'

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}))

const mockedAxiosPost = vi.mocked(axios.post)

const URL = 'https://findesa.example.com/api/meta-statuses'
const TOKEN = 'secret-token'
const PHONE = '5511999999999'

function buildLogger() {
  const error = vi.fn()
  const logger = { forBot: () => ({ error }) }
  return { logger, error }
}

function buildStatus(overrides: Partial<WhatsAppStatusValue> = {}): WhatsAppStatusValue {
  return {
    id: 'wamid.STATUS',
    status: 'delivered',
    timestamp: '1795646400',
    recipient_id: PHONE,
    pricing: { billable: true, pricing_model: 'PMP', category: 'utility' },
    ...overrides,
  }
}

function httpError(status: number) {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } })
}

describe('buildFindesaStatuses', () => {
  test('maps id, status, timestamp and pricing category', () => {
    expect(buildFindesaStatuses([buildStatus()])).toEqual([
      { meta_message_id: 'wamid.STATUS', status: 'delivered', timestamp: '1795646400', category: 'utility' },
    ])
  })

  test('sends a null category when the status carries no pricing', () => {
    const [status] = buildFindesaStatuses([buildStatus({ status: 'read', pricing: undefined })])
    expect(status).toEqual({
      meta_message_id: 'wamid.STATUS',
      status: 'read',
      timestamp: '1795646400',
      category: null,
    })
  })

  test.each([[null], ['utility'], [{ category: 42 }], [{}], [[]]])(
    'sends a null category when pricing is malformed (%j)',
    (pricing) => {
      const [status] = buildFindesaStatuses([buildStatus({ pricing })])
      expect(status!.category).toBeNull()
    }
  )

  test('sends only the error code of a failed status', () => {
    const [status] = buildFindesaStatuses([
      buildStatus({
        status: 'failed',
        pricing: undefined,
        errors: [
          {
            code: 131026,
            title: 'Message undeliverable',
            message: 'Message undeliverable',
            error_data: { details: `Recipient ${PHONE} is not a valid WhatsApp user` },
          },
        ],
      }),
    ])
    expect(status!.errors).toEqual([{ code: 131026 }])
  })

  test('never carries the phone, the bsuid or error texts', () => {
    const serialized = JSON.stringify(
      buildFindesaStatuses([
        buildStatus({
          status: 'failed',
          recipient_user_id: 'BR.1234567890',
          errors: [{ code: 131026, title: 'Some title', message: 'Some message', error_data: { details: PHONE } }],
        }),
      ])
    )
    expect(serialized).not.toContain(PHONE)
    expect(serialized).not.toContain('BR.1234567890')
    expect(serialized).not.toContain('Some title')
    expect(serialized).not.toContain('Some message')
  })

  test('keeps the pricing category of a status parsed from the raw Meta webhook', () => {
    const payload = WhatsAppPayloadSchema.parse({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '5511888888888', phone_number_id: 'phone-number-id-1' },
                statuses: [
                  {
                    id: 'wamid.RAW',
                    status: 'sent',
                    timestamp: '1795646400',
                    recipient_id: PHONE,
                    conversation: { id: 'conversation-1', origin: { type: 'marketing' } },
                    pricing: { billable: true, pricing_model: 'PMP', category: 'marketing', type: 'regular' },
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    const change = payload.entry[0]!.changes[0]!
    const statuses = change.field === 'messages' ? (change.value.statuses ?? []) : []
    expect(buildFindesaStatuses(statuses)).toEqual([
      { meta_message_id: 'wamid.RAW', status: 'sent', timestamp: '1795646400', category: 'marketing' },
    ])
  })
})

describe('forwardStatusesToFindesa', () => {
  beforeEach(() => {
    mockedAxiosPost.mockReset()
  })

  test('posts every status of the webhook in a single request with the token header', async () => {
    mockedAxiosPost.mockResolvedValue({ status: 200 })
    const { logger, error } = buildLogger()

    await forwardStatusesToFindesa({
      url: URL,
      token: TOKEN,
      statuses: [buildStatus({ id: 'wamid.A' }), buildStatus({ id: 'wamid.B', status: 'read', pricing: undefined })],
      logger: logger as never,
    })

    expect(mockedAxiosPost).toHaveBeenCalledTimes(1)
    const [url, body, config] = mockedAxiosPost.mock.calls[0]!
    expect(url).toBe(URL)
    expect(body).toEqual([
      { meta_message_id: 'wamid.A', status: 'delivered', timestamp: '1795646400', category: 'utility' },
      { meta_message_id: 'wamid.B', status: 'read', timestamp: '1795646400', category: null },
    ])
    expect(config).toMatchObject({
      headers: { 'x-daily-messages-token': TOKEN, 'Content-Type': 'application/json' },
      timeout: 3000,
    })
    expect(error).not.toHaveBeenCalled()
  })

  test.each([
    ['url', { url: undefined, token: TOKEN }],
    ['token', { url: URL, token: undefined }],
  ])('does nothing when the %s secret is missing', async (_name, secrets) => {
    const { logger, error } = buildLogger()

    await forwardStatusesToFindesa({ ...secrets, statuses: [buildStatus()], logger: logger as never })

    expect(mockedAxiosPost).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  test.each([[undefined], [[]]])('does nothing when the webhook has no statuses (%j)', async (statuses) => {
    const { logger } = buildLogger()

    await forwardStatusesToFindesa({ url: URL, token: TOKEN, statuses, logger: logger as never })

    expect(mockedAxiosPost).not.toHaveBeenCalled()
  })

  test('splits more than 100 statuses into requests of at most 100', async () => {
    mockedAxiosPost.mockResolvedValue({ status: 200 })
    const { logger } = buildLogger()
    const statuses = Array.from({ length: 101 }, (_, index) => buildStatus({ id: `wamid.${index}` }))

    await forwardStatusesToFindesa({ url: URL, token: TOKEN, statuses, logger: logger as never })

    expect(mockedAxiosPost).toHaveBeenCalledTimes(2)
    expect(mockedAxiosPost.mock.calls[0]![1]).toHaveLength(100)
    expect(mockedAxiosPost.mock.calls[1]![1]).toHaveLength(1)
  })

  test('retries once when findesa answers 5xx', async () => {
    mockedAxiosPost.mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce({ status: 200 })
    const { logger, error } = buildLogger()

    await forwardStatusesToFindesa({ url: URL, token: TOKEN, statuses: [buildStatus()], logger: logger as never })

    expect(mockedAxiosPost).toHaveBeenCalledTimes(2)
    expect(mockedAxiosPost.mock.calls[1]![1]).toEqual(mockedAxiosPost.mock.calls[0]![1])
    expect(error).not.toHaveBeenCalled()
  })

  test('retries once when findesa does not answer (timeout or network error)', async () => {
    mockedAxiosPost
      .mockRejectedValueOnce(new Error('timeout of 3000ms exceeded'))
      .mockResolvedValueOnce({ status: 200 })
    const { logger, error } = buildLogger()

    await forwardStatusesToFindesa({ url: URL, token: TOKEN, statuses: [buildStatus()], logger: logger as never })

    expect(mockedAxiosPost).toHaveBeenCalledTimes(2)
    expect(error).not.toHaveBeenCalled()
  })

  test('gives up after the second failed attempt, logs and never throws', async () => {
    mockedAxiosPost.mockRejectedValue(httpError(500))
    const { logger, error } = buildLogger()

    await expect(
      forwardStatusesToFindesa({ url: URL, token: TOKEN, statuses: [buildStatus()], logger: logger as never })
    ).resolves.toBeUndefined()

    expect(mockedAxiosPost).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0]![0]).toContain('Failed to forward 1 WhatsApp status(es) to findesa after 2 attempt(s)')
  })

  test.each([[400], [401]])('does not retry when findesa answers %i', async (status) => {
    mockedAxiosPost.mockRejectedValue(httpError(status))
    const { logger, error } = buildLogger()

    await forwardStatusesToFindesa({ url: URL, token: TOKEN, statuses: [buildStatus()], logger: logger as never })

    expect(mockedAxiosPost).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0]![0]).toContain(`HTTP ${status}`)
  })

  test('never logs the message id, the phone or the token', async () => {
    mockedAxiosPost.mockRejectedValue(httpError(500))
    const { logger, error } = buildLogger()

    await forwardStatusesToFindesa({
      url: URL,
      token: TOKEN,
      statuses: [buildStatus({ id: 'wamid.SECRET' })],
      logger: logger as never,
    })

    const logged = JSON.stringify(error.mock.calls)
    expect(logged).not.toContain('wamid.SECRET')
    expect(logged).not.toContain(PHONE)
    expect(logged).not.toContain(TOKEN)
  })

  test('never throws when building the body fails', async () => {
    const { logger, error } = buildLogger()
    const broken = { ...buildStatus() }
    Object.defineProperty(broken, 'id', {
      get() {
        throw new Error('boom')
      },
    })

    await expect(
      forwardStatusesToFindesa({ url: URL, token: TOKEN, statuses: [broken], logger: logger as never })
    ).resolves.toBeUndefined()

    expect(mockedAxiosPost).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledTimes(1)
  })
})
