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

/** Only the exact value 'darwin' diverts; an absent tag or any other value keeps the default path. */
export function isDelegatedToDarwin(tags: Record<string, string | undefined>): boolean {
  return tags.handoffOwner === 'darwin'
}

const handoffBodySchema = z.object({
  conversationId: z.string().min(1),
  handoffOwner: z.enum(['darwin', 'botpress']),
  handoffResult: z.enum(['continue', 'error']).optional(),
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

  // Tags first, event second: if the event fails the conversation has already been returned.
  await client.updateConversation({
    id: conversationId,
    tags: { handoffOwner, ...(handoffResult && { handoffResult }) },
  })
  if (handoffResult) {
    await client.createEvent({ type: 'handoffReturned', conversationId, payload: { handoffResult } })
  }

  logger.forBot().info(`Handoff: conversation ${conversationId} now owned by ${handoffOwner}`)
  return { status: 200, body: JSON.stringify({ conversationId, handoffOwner, handoffResult: handoffResult ?? null }) }
}
