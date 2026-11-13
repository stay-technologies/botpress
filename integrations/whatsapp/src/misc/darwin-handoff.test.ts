import axios from 'axios'
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { handoffHandler, isDelegatedToDarwin, isHandoffReturnMessage, requestDelegation } from './darwin-handoff'

const API_KEY = 'handoff-key'
const RETURN_BODY = { conversationId: 'conv-1', handoffOwner: 'botpress', handoffResult: 'continue' }
const VALID_AUTH = {
  headers: { 'x-api-key': API_KEY } as Record<string, string>,
  apiKey: API_KEY as string | undefined,
}

function setup(body: unknown, auth: { headers: Record<string, string>; apiKey: string | undefined } = VALID_AUTH) {
  const { headers, apiKey } = auth
  const calls: string[] = []
  const client = {
    updateConversation: vi.fn(async () => void calls.push('updateConversation')),
    listParticipants: vi.fn(async () => ({
      participants: [
        { id: 'bot-user', tags: {} },
        { id: 'user-1', tags: { userId: '5511999999999' } },
      ],
    })),
    createMessage: vi.fn(async (_args: { payload: Record<string, unknown> }) => void calls.push('createMessage')),
    createEvent: vi.fn(),
  }
  const logger = { forBot: () => ({ info: vi.fn(), error: vi.fn() }) }
  const req = { method: 'POST', path: '/handoff', query: '', headers, body: JSON.stringify(body) }
  const run = () => handoffHandler({ req, client: client as never, logger: logger as never, apiKey })
  return { client, calls, run }
}

describe('isDelegatedToDarwin', () => {
  test('only the exact value "darwin" delegates', () => {
    expect(isDelegatedToDarwin({ handoffOwner: 'darwin' })).toBe(true)
    expect(isDelegatedToDarwin({})).toBe(false)
    expect(isDelegatedToDarwin({ handoffOwner: 'botpress' })).toBe(false)
    expect(isDelegatedToDarwin({ handoffOwner: 'Darwin' })).toBe(false)
    expect(isDelegatedToDarwin({ handoffOwner: '' })).toBe(false)
  })
})

describe('isHandoffReturnMessage', () => {
  test('only the injected return message is flagged', () => {
    expect(isHandoffReturnMessage({ handoffReturn: 'true' })).toBe(true)
    expect(isHandoffReturnMessage({ id: 'wamid.X' })).toBe(false)
    expect(isHandoffReturnMessage({})).toBe(false)
  })
})

describe('handoffHandler', () => {
  test('without handoffResult: only writes handoffOwner, no message', async () => {
    const { client, run } = setup({ conversationId: 'conv-1', handoffOwner: 'darwin' })

    const res = await run()

    expect(res.status).toBe(200)
    expect(client.updateConversation).toHaveBeenCalledWith({ id: 'conv-1', tags: { handoffOwner: 'darwin' } })
    expect(client.createMessage).not.toHaveBeenCalled()
  })

  test('with handoffResult: writes both tags FIRST, then injects the fixed fake incoming message', async () => {
    const { client, calls, run } = setup(RETURN_BODY)

    const res = await run()

    expect(res.status).toBe(200)
    expect(calls).toEqual(['updateConversation', 'createMessage'])
    expect(client.updateConversation).toHaveBeenCalledWith({
      id: 'conv-1',
      tags: { handoffOwner: 'botpress', handoffResult: 'continue' },
    })
    expect(client.listParticipants).toHaveBeenCalledWith({ id: 'conv-1' })
    expect(client.createMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      userId: 'user-1',
      type: 'text',
      payload: { text: '__handoff_returned__' },
      tags: { handoffReturn: 'true' },
    })
    // a plain incoming message: never synthetic, and no event is created anymore
    expect(client.createMessage.mock.calls[0]?.[0]).not.toHaveProperty('origin')
    expect(client.createEvent).not.toHaveBeenCalled()
  })

  test('message injection fails: tags were already written (conversation is back)', async () => {
    const { client, run } = setup(RETURN_BODY)
    client.createMessage.mockRejectedValueOnce(new Error('boom'))

    await expect(run()).rejects.toThrow('boom')

    expect(client.updateConversation).toHaveBeenCalledTimes(1)
  })

  test('no WhatsApp user among the participants: fails after the tags, no message', async () => {
    const { client, run } = setup(RETURN_BODY)
    client.listParticipants.mockResolvedValueOnce({ participants: [{ id: 'bot-user', tags: {} }] } as never)

    await expect(run()).rejects.toThrow('no WhatsApp user')

    expect(client.updateConversation).toHaveBeenCalledTimes(1)
    expect(client.createMessage).not.toHaveBeenCalled()
  })

  test.each([
    ['missing header', {}, API_KEY],
    ['wrong key', { 'x-api-key': 'nope' }, API_KEY],
    ['secret not configured', { 'x-api-key': API_KEY }, undefined],
    ['secret empty and header empty', { 'x-api-key': '' }, ''],
  ])('refuses with 401 and no side effect: %s', async (_label, headers, apiKey) => {
    const { client, run } = setup({ conversationId: 'conv-1', handoffOwner: 'darwin' }, { headers, apiKey })

    const res = await run()

    expect(res.status).toBe(401)
    expect(client.updateConversation).not.toHaveBeenCalled()
    expect(client.createMessage).not.toHaveBeenCalled()
  })

  test.each([
    ['unknown owner', { conversationId: 'conv-1', handoffOwner: 'someone' }],
    ['missing conversationId', { handoffOwner: 'darwin' }],
    ['unknown result', { conversationId: 'conv-1', handoffOwner: 'botpress', handoffResult: 'none' }],
  ])('invalid body → 400 and no side effect: %s', async (_label, body) => {
    const { client, run } = setup(body)

    const res = await run()

    expect(res.status).toBe(400)
    expect(client.updateConversation).not.toHaveBeenCalled()
    expect(client.createMessage).not.toHaveBeenCalled()
  })
})

describe('requestDelegation', () => {
  const URL = 'https://darwin.example.com/chatbot-bff/conversation/v1/delegations'
  const post = vi.spyOn(axios, 'post')

  function run(overrides: Record<string, unknown> = {}) {
    const error = vi.fn()
    const logger = { forBot: () => ({ error }) }
    const promise = requestDelegation({
      url: URL,
      apiKey: 'bff-key',
      tenant: undefined,
      conversationId: 'conv-1',
      sectionId: 'handoff-proof',
      phoneNumber: '+5511999999999',
      logger: logger as never,
      ...overrides,
    })
    return { promise, error }
  }

  beforeEach(() => {
    post.mockReset()
  })

  test('posts the delegation question with the key and the default tenant, returns delegated = true', async () => {
    post.mockResolvedValueOnce({ data: { delegated: true } })

    const { promise, error } = run()

    await expect(promise).resolves.toBe(true)
    expect(post).toHaveBeenCalledWith(
      URL,
      { conversationId: 'conv-1', sectionId: 'handoff-proof', phoneNumber: '+5511999999999' },
      {
        headers: { 'X-API-KEY': 'bff-key', 'x-execution-tenant': 'TEST', 'Content-Type': 'application/json' },
        timeout: 20_000,
      }
    )
    expect(error).not.toHaveBeenCalled()
  })

  test('sends the tenant given on the card', async () => {
    post.mockResolvedValueOnce({ data: { delegated: true } })

    await run({ tenant: 'STAY' }).promise

    expect(post.mock.calls[0]?.[2]?.headers).toMatchObject({ 'x-execution-tenant': 'STAY' })
  })

  test.each([
    ['Darwin says no', { data: { delegated: false } }],
    ['unexpected body', { data: {} }],
    ['truthy but not true', { data: { delegated: 'true' } }],
  ])('not delegated: %s', async (_label, response) => {
    post.mockResolvedValueOnce(response)

    await expect(run().promise).resolves.toBe(false)
  })

  test('request fails: not delegated, error logged with the conversationId, never throws', async () => {
    post.mockRejectedValueOnce(new Error('timeout of 20000ms exceeded'))

    const { promise, error } = run()

    await expect(promise).resolves.toBe(false)
    expect(error.mock.calls[0]?.[0]).toContain('conv-1')
    expect(error.mock.calls[0]?.[0]).toContain('timeout')
  })

  test.each([
    ['url missing', { url: undefined }],
    ['api key missing', { apiKey: '' }],
    ['conversation without userPhone', { phoneNumber: undefined }],
  ])('no request and not delegated: %s', async (_label, overrides) => {
    const { promise, error } = run(overrides)

    await expect(promise).resolves.toBe(false)
    expect(post).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledTimes(1)
  })
})
