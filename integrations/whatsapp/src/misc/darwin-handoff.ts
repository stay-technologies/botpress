import { Request, z } from '@botpress/sdk'
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

const handoffBodySchema = z
  .object({
    conversationId: z.string().min(1),
    handoffOwner: z.enum(['darwin', 'botpress']),
    handoffResult: z.enum(['continue', 'error']).optional(),
    // Button-reply shaped message the bot asked for when delegating; Darwin stores it and sends it back.
    returnMessage: z.object({ text: z.string().min(1), value: z.string().optional() }).optional(),
  })
  .refine((body) => !body.returnMessage || body.handoffResult, {
    message: 'returnMessage requires handoffResult',
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
  const { conversationId, handoffOwner, handoffResult, returnMessage } = body

  // Tags first, message second: if the message fails the conversation has already been returned.
  await client.updateConversation({
    id: conversationId,
    tags: { handoffOwner, ...(handoffResult && { handoffResult }) },
  })
  if (returnMessage) {
    // A plain incoming message, as if the user had answered: it is what wakes a flow parked on
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
      payload: { text: returnMessage.text, ...(returnMessage.value !== undefined && { value: returnMessage.value }) },
      tags: { handoffReturn: 'true' },
    })
  }

  logger.forBot().info(`Handoff: conversation ${conversationId} now owned by ${handoffOwner}`)
  return { status: 200, body: JSON.stringify({ conversationId, handoffOwner, handoffResult: handoffResult ?? null }) }
}
