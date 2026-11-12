import { describe, test, expect, vi } from 'vitest'
import { handoffHandler, isDelegatedToDarwin } from './darwin-handoff'

const API_KEY = 'handoff-key'
const VALID_AUTH = {
  headers: { 'x-api-key': API_KEY } as Record<string, string>,
  apiKey: API_KEY as string | undefined,
}

function setup(body: unknown, auth: { headers: Record<string, string>; apiKey: string | undefined } = VALID_AUTH) {
  const { headers, apiKey } = auth
  const calls: string[] = []
  const client = {
    updateConversation: vi.fn(async () => void calls.push('updateConversation')),
    createEvent: vi.fn(async () => void calls.push('createEvent')),
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

describe('handoffHandler', () => {
  test('without handoffResult: only writes handoffOwner, no event', async () => {
    const { client, run } = setup({ conversationId: 'conv-1', handoffOwner: 'darwin' })

    const res = await run()

    expect(res.status).toBe(200)
    expect(client.updateConversation).toHaveBeenCalledWith({ id: 'conv-1', tags: { handoffOwner: 'darwin' } })
    expect(client.createEvent).not.toHaveBeenCalled()
  })

  test('with handoffResult: writes both tags FIRST, then creates handoffReturned', async () => {
    const { client, calls, run } = setup({
      conversationId: 'conv-1',
      handoffOwner: 'botpress',
      handoffResult: 'continue',
    })

    const res = await run()

    expect(res.status).toBe(200)
    expect(calls).toEqual(['updateConversation', 'createEvent'])
    expect(client.updateConversation).toHaveBeenCalledWith({
      id: 'conv-1',
      tags: { handoffOwner: 'botpress', handoffResult: 'continue' },
    })
    expect(client.createEvent).toHaveBeenCalledWith({
      type: 'handoffReturned',
      conversationId: 'conv-1',
      payload: { handoffResult: 'continue' },
    })
  })

  test('event creation fails: tags were already written (conversation is back)', async () => {
    const { client, run } = setup({ conversationId: 'conv-1', handoffOwner: 'botpress', handoffResult: 'continue' })
    client.createEvent.mockRejectedValueOnce(new Error('boom'))

    await expect(run()).rejects.toThrow('boom')

    expect(client.updateConversation).toHaveBeenCalledTimes(1)
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
    expect(client.createEvent).not.toHaveBeenCalled()
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
    expect(client.createEvent).not.toHaveBeenCalled()
  })
})
