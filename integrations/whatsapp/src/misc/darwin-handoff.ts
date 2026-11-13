import { Request, z } from '@botpress/sdk'
import axios from 'axios'
import * as crypto from 'crypto'
import * as bp from '.botpress'

/**
 * Conversation handoff between the bot and Darwin (FOU-1287).
 * The owner of a conversation is the `handoffOwner` conversation tag; Darwin flips it
 * through the POST /handoff route of the integration webhook.
 */

export const HANDOFF_PATH = '/handoff'
const HANDOFF_API_KEY_HEADER = 'x-api-key'

/** The injected return message has no wamid: nothing to mark as read or react to on WhatsApp. */
export function isHandoffReturnMessage(tags: Record<string, string | undefined>): boolean {
  return tags.handoffReturn === 'true'
}

/** Only the exact value 'darwin' diverts; an absent tag or any other value keeps the default path. */
export function isDelegatedToDarwin(tags: Record<string, string | undefined>): boolean {
  return tags.handoffOwner === 'darwin'
}

/** Fixed text of the fake incoming message injected when Darwin returns the conversation. */
export const HANDOFF_RETURNED_TEXT = '__handoff_returned__'

const handoffBodySchema = z
  .object({
    conversationId: z.string().min(1),
    handoffOwner: z.enum(['darwin', 'botpress']),
    handoffResult: z.enum(['continue', 'error']).optional(),
  })
  // A result is a return: with Darwin as owner it would wake the bot while Darwin still drives.
  .refine((body) => !body.handoffResult || body.handoffOwner === 'botpress', {
    message: 'handoffResult requires handoffOwner = botpress',
  })

function isValidApiKey(received: string | undefined, expected: string | undefined): boolean {
  if (!received || !expected) {
    return false
  }
  const receivedHash = crypto.createHash('sha256').update(received).digest()
  const expectedHash = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(receivedHash, expectedHash)
}

export type HandoffHandlerProps = {
  req: Request
  client: bp.Client
  logger: bp.Logger
  apiKey: string | undefined
}

export async function handoffHandler(props: HandoffHandlerProps): Promise<{ status: number; body: string }> {
  const { req, client, logger, apiKey } = props

  if (!isValidApiKey(req.headers[HANDOFF_API_KEY_HEADER], apiKey)) {
    return { status: 401, body: 'Invalid handoff API key' }
  }
  if (req.method.toUpperCase() !== 'POST') {
    return { status: 405, body: 'Method not allowed' }
  }

  let body: z.infer<typeof handoffBodySchema>
  try {
    body = handoffBodySchema.parse(JSON.parse(req.body ?? ''))
  } catch (thrown: unknown) {
    const errMsg = thrown instanceof Error ? thrown.message : 'Unknown error thrown'
    return { status: 400, body: `Invalid handoff body: ${errMsg}` }
  }
  const { conversationId, handoffOwner, handoffResult } = body

  // Tags first, message second: if the message fails the conversation has already been returned.
  await client.updateConversation({
    id: conversationId,
    tags: { handoffOwner, ...(handoffResult && { handoffResult }) },
  })
  if (handoffResult) {
    // A fake incoming message, as if the user had answered: it is what wakes a flow parked on
    // "wait for user input". It never goes to WhatsApp nor to Darwin.
    const { participants } = await client.listParticipants({ id: conversationId })
    const user = participants.find((participant) => participant.tags.userId)
    if (!user) {
      throw new Error(`Handoff: no WhatsApp user found in conversation ${conversationId}`)
    }
    await client.createMessage({
      conversationId,
      userId: user.id,
      type: 'text',
      payload: { text: HANDOFF_RETURNED_TEXT },
      tags: { handoffReturn: 'true' },
    })
  }

  logger.forBot().info(`Handoff: conversation ${conversationId} now owned by ${handoffOwner}`)
  return { status: 200, body: JSON.stringify({ conversationId, handoffOwner, handoffResult: handoffResult ?? null }) }
}

// shortcut: the proof runs on a single tenant; pass the conversation's tenant on the card before production.
export const DEFAULT_DELEGATION_TENANT = 'TEST'
// Darwin answers only after confirming the owner on POST /handoff and sending its first message.
const DELEGATION_TIMEOUT_MS = 20_000

export type RequestDelegationParams = {
  url: string | undefined
  apiKey: string | undefined
  tenant: string | undefined
  conversationId: string
  sectionId: string
  phoneNumber: string | undefined
  logger: bp.Logger
}

/**
 * Asks Darwin whether it takes over the conversation. Never throws: anything other than an
 * explicit `{ delegated: true }` means "not delegated" and the bot keeps the conversation.
 */
export async function requestDelegation(params: RequestDelegationParams): Promise<boolean> {
  const { url, apiKey, tenant, conversationId, sectionId, phoneNumber, logger } = params
  try {
    if (!url || !apiKey) {
      throw new Error('delegation secrets missing')
    }
    if (!phoneNumber) {
      throw new Error('conversation has no userPhone tag')
    }
    const response = await axios.post(
      url,
      { conversationId, sectionId, phoneNumber },
      {
        headers: {
          'X-API-KEY': apiKey,
          'x-execution-tenant': tenant || DEFAULT_DELEGATION_TENANT,
          'Content-Type': 'application/json',
        },
        timeout: DELEGATION_TIMEOUT_MS,
      }
    )
    return response.data?.delegated === true
  } catch (thrown: unknown) {
    const errMsg = thrown instanceof Error ? thrown.message : 'Unknown error thrown'
    logger.forBot().error(`Handoff: conversation ${conversationId} was NOT delegated to Darwin: ${errMsg}`)
    return false
  }
}
