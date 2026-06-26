import axios from 'axios'
import { extractContactIdentifiers } from './bsuid-extraction'
import { isInboundForwardingEnabled } from './feature-toggle'
import { WhatsAppMessageValue } from './types'
import * as bp from '.botpress'

type InboundMessage = NonNullable<WhatsAppMessageValue['messages']>[number]
type InboundContact = NonNullable<WhatsAppMessageValue['contacts']>[number]

export type InboundEnvelope = {
  source: 'whatsapp'
  bot: {
    phoneNumberId: string
    displayPhoneNumber: string
  }
  events: Array<{
    wamid: string
    occurredAt: string
    type: string
    content: unknown
    text?: string
    sender: {
      phone: string | null
      bsuid: string | null
      name: string | null
    }
    replyToWamid: string | null
  }>
}

const POST_TIMEOUT_MS = 3000

/**
 * Converts a WhatsApp epoch-seconds timestamp string into an ISO-8601 UTC string.
 * Falls back to the current time (logged) when the timestamp is not a valid number,
 * so forwarding stays best-effort and never crashes the hot path.
 */
function toIsoOccurredAt(timestamp: string, logger: bp.Logger): string {
  const epochSeconds = Number(timestamp)
  if (Number.isNaN(epochSeconds)) {
    logger
      .forBot()
      .error(`Invalid WhatsApp message timestamp "${timestamp}" while forwarding to Darwin, using current time`)
    return new Date().toISOString()
  }
  return new Date(epochSeconds * 1000).toISOString()
}

/**
 * Pure builder: turns a single inbound WhatsApp message into the Darwin inbound contract envelope.
 * Media is NOT downloaded — `content` is the raw per-type sub-object exactly as received from Meta.
 */
export function buildInboundEnvelope(
  message: InboundMessage,
  value: WhatsAppMessageValue,
  contact: InboundContact | undefined,
  logger: bp.Logger
): InboundEnvelope {
  const { bsuid, phone } = contact ? extractContactIdentifiers(contact) : { bsuid: undefined, phone: undefined }

  const content = (message as Record<string, unknown>)[message.type]
  const text = message.type === 'text' ? message.text.body : undefined

  return {
    source: 'whatsapp',
    bot: {
      phoneNumberId: value.metadata.phone_number_id,
      displayPhoneNumber: value.metadata.display_phone_number,
    },
    events: [
      {
        wamid: message.id,
        occurredAt: toIsoOccurredAt(message.timestamp, logger),
        type: message.type,
        content,
        ...(text !== undefined && { text }),
        sender: {
          phone: phone ?? null,
          bsuid: bsuid ?? null,
          name: contact?.profile?.name ?? null,
        },
        replyToWamid: message.context?.id ?? null,
      },
    ],
  }
}

export type ForwardInboundMessageParams = {
  url: string | undefined
  apiKey: string | undefined
  phone: string
  message: InboundMessage
  value: WhatsAppMessageValue
  contact: InboundContact | undefined
  logger: bp.Logger
}

/**
 * Best-effort forwarder. Gated by (both secrets present) AND (Statsig gate on).
 * Any failure is logged and swallowed — it must never break the bot's hot path.
 */
export async function forwardInboundMessage(params: ForwardInboundMessageParams): Promise<void> {
  const { url, apiKey, phone, message, value, contact, logger } = params

  // Off-by-default case: missing secrets is normal, do not emit noisy per-message warnings
  // and do not even consult the gate.
  if (!url || !apiKey) {
    return
  }

  if (!(await isInboundForwardingEnabled(phone, logger))) {
    return
  }

  try {
    const envelope = buildInboundEnvelope(message, value, contact, logger)
    await axios.post(url, envelope, {
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: POST_TIMEOUT_MS,
    })
  } catch (thrown: unknown) {
    const errMsg = thrown instanceof Error ? thrown.message : 'Unknown error thrown'
    logger.forBot().error(`Failed to forward inbound WhatsApp message to Darwin: ${errMsg}`)
  }
}
