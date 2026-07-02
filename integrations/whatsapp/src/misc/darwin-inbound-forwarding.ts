import axios from 'axios'
import { extractContactIdentifiers } from './bsuid-extraction'
import { isInboundForwardingEnabled } from './feature-toggle'
import { WhatsAppEchoMessage, WhatsAppMessageEchoValue, WhatsAppMessageValue, WhatsAppStatusValue } from './types'
import * as bp from '.botpress'

type InboundMessage = NonNullable<WhatsAppMessageValue['messages']>[number]
type InboundContact = NonNullable<WhatsAppMessageValue['contacts']>[number]

type BotMetadata = {
  phoneNumberId: string
  // Optional in Darwin's DTO; unavailable at the send path (only webhook metadata carries it).
  displayPhoneNumber?: string
}

type MessageEvent = {
  wamid: string
  occurredAt: string
  type: string
  direction?: 'INBOUND' | 'OUTBOUND'
  content: unknown
  text?: string
  sender: {
    phone: string | null
    bsuid: string | null
    name: string | null
  }
  replyToWamid: string | null
}

type StatusEvent = {
  kind: 'status'
  wamid: string
  occurredAt: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
}

export type DarwinEnvelope = {
  source: 'whatsapp'
  bot: BotMetadata
  events: Array<MessageEvent | StatusEvent>
}

// Kept as an alias for backwards compatibility with existing inbound call sites/tests.
export type InboundEnvelope = DarwinEnvelope

const POST_TIMEOUT_MS = 3000

/**
 * Converts a WhatsApp epoch-seconds timestamp string into an ISO-8601 UTC string.
 * Falls back to the current time (logged) when the timestamp is not a valid number,
 * so forwarding stays best-effort and never crashes the hot path.
 */
function toIsoOccurredAt(timestamp: string, logger: bp.Logger): string {
  const epochSeconds = Number(timestamp)
  if (timestamp.trim() === '' || !Number.isFinite(epochSeconds)) {
    logger
      .forBot()
      .error(`Invalid WhatsApp message timestamp "${timestamp}" while forwarding to Darwin, using current time`)
    return new Date().toISOString()
  }
  return new Date(epochSeconds * 1000).toISOString()
}

/**
 * Best-effort POST of a Darwin envelope. Any failure is logged (with the given label)
 * and swallowed — it must never break the bot's hot path.
 */
async function postEnvelope(
  url: string,
  apiKey: string,
  envelope: DarwinEnvelope,
  logger: bp.Logger,
  label: string
): Promise<void> {
  try {
    await axios.post(url, envelope, {
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: POST_TIMEOUT_MS,
    })
  } catch (thrown: unknown) {
    const errMsg = thrown instanceof Error ? thrown.message : 'Unknown error thrown'
    logger.forBot().error(`Failed to forward ${label} to Darwin: ${errMsg}`)
  }
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
): DarwinEnvelope {
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
        direction: 'INBOUND',
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

/**
 * Pure builder: turns a single outbound WhatsApp echo into the Darwin contract envelope.
 * `sender` carries the RECIPIENT for outbound (echoes carry no recipient bsuid).
 * Media is NOT downloaded — `content` is the raw per-type sub-object exactly as received from Meta.
 */
export function buildOutboundEnvelope(
  echo: WhatsAppEchoMessage,
  value: WhatsAppMessageEchoValue,
  logger: bp.Logger
): DarwinEnvelope {
  const content = (echo as Record<string, unknown>)[echo.type]
  const text = echo.type === 'text' ? echo.text.body : undefined

  return {
    source: 'whatsapp',
    bot: {
      phoneNumberId: value.metadata.phone_number_id,
      displayPhoneNumber: value.metadata.display_phone_number,
    },
    events: [
      {
        wamid: echo.id,
        occurredAt: toIsoOccurredAt(echo.timestamp, logger),
        type: echo.type,
        direction: 'OUTBOUND',
        content,
        ...(text !== undefined && { text }),
        sender: {
          phone: echo.to ?? null,
          bsuid: null,
          name: null,
        },
        replyToWamid: echo.context?.id ?? null,
      },
    ],
  }
}

export type SentMessageParams = {
  wamid: string
  /** Meta message type as exposed by whatsapp-api-js (`message._type`), e.g. 'text', 'image', 'template'. */
  messageType: string
  /** The whatsapp-api-js ClientMessage instance passed to `whatsapp.sendMessage`. */
  message: unknown
  recipientPhone: string | undefined
  recipientBsuid: string | undefined
  botPhoneNumberId: string
  logger: bp.Logger
}

/**
 * Pure builder: turns a just-sent Cloud API message into the Darwin contract envelope.
 * whatsapp-api-js message classes JSON-serialize to the exact per-type sub-object the
 * Meta API receives, matching the `content` shape of the inbound/echo builders.
 * `sender` carries the RECIPIENT for outbound. Never throws.
 */
export function buildSentMessageEnvelope(params: SentMessageParams): DarwinEnvelope {
  const { wamid, messageType, message, recipientPhone, recipientBsuid, botPhoneNumberId, logger } = params

  let content: unknown = null
  try {
    content = JSON.parse(JSON.stringify(message))
  } catch (thrown: unknown) {
    const errMsg = thrown instanceof Error ? thrown.message : 'Unknown error thrown'
    logger.forBot().error(`Failed to serialize sent ${messageType} message while forwarding to Darwin: ${errMsg}`)
  }

  const body = (content as Record<string, unknown> | null)?.body
  const text = messageType === 'text' && typeof body === 'string' ? body : undefined

  return {
    source: 'whatsapp',
    bot: {
      phoneNumberId: botPhoneNumberId,
    },
    events: [
      {
        wamid,
        occurredAt: new Date().toISOString(),
        type: messageType,
        direction: 'OUTBOUND',
        content,
        ...(text !== undefined && { text }),
        sender: {
          phone: recipientPhone ?? null,
          bsuid: recipientBsuid ?? null,
          name: null,
        },
        replyToWamid: null,
      },
    ],
  }
}

/**
 * Pure builder: turns a single WhatsApp delivery status into the Darwin contract envelope.
 */
export function buildStatusEnvelope(
  status: WhatsAppStatusValue,
  metadata: { phone_number_id: string; display_phone_number: string },
  logger: bp.Logger
): DarwinEnvelope {
  return {
    source: 'whatsapp',
    bot: {
      phoneNumberId: metadata.phone_number_id,
      displayPhoneNumber: metadata.display_phone_number,
    },
    events: [
      {
        kind: 'status',
        wamid: status.id,
        occurredAt: toIsoOccurredAt(status.timestamp, logger),
        status: status.status,
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

  const envelope = buildInboundEnvelope(message, value, contact, logger)
  await postEnvelope(url, apiKey, envelope, logger, 'inbound WhatsApp message')
}

export type ForwardOutboundMessageParams = {
  url: string | undefined
  apiKey: string | undefined
  phone: string
  echo: WhatsAppEchoMessage
  value: WhatsAppMessageEchoValue
  logger: bp.Logger
}

/**
 * Best-effort forwarder for outbound (echo) messages. Same gating as the inbound forwarder.
 */
export async function forwardOutboundMessage(params: ForwardOutboundMessageParams): Promise<void> {
  const { url, apiKey, phone, echo, value, logger } = params

  if (!url || !apiKey) {
    return
  }

  if (!(await isInboundForwardingEnabled(phone, logger))) {
    return
  }

  const envelope = buildOutboundEnvelope(echo, value, logger)
  await postEnvelope(url, apiKey, envelope, logger, 'outbound WhatsApp message')
}

export type ForwardSentMessageParams = SentMessageParams & {
  url: string | undefined
  apiKey: string | undefined
}

/**
 * Best-effort forwarder for messages just sent through the Cloud API. Same gating as the
 * other forwarders. Cloud API sends never generate `smb_message_echoes` webhooks (echoes
 * only cover WhatsApp Business App coexistence), so this is the only path that gets
 * bot-sent messages to Darwin.
 */
export async function forwardSentMessage(params: ForwardSentMessageParams): Promise<void> {
  const { url, apiKey, recipientPhone, recipientBsuid, logger } = params

  if (!url || !apiKey) {
    return
  }

  const gateKey = recipientPhone ?? recipientBsuid
  if (!gateKey) {
    return
  }

  if (!(await isInboundForwardingEnabled(gateKey, logger))) {
    return
  }

  const envelope = buildSentMessageEnvelope(params)
  await postEnvelope(url, apiKey, envelope, logger, 'sent WhatsApp message')
}

export type ForwardStatusParams = {
  url: string | undefined
  apiKey: string | undefined
  phone: string
  status: WhatsAppStatusValue
  metadata: { phone_number_id: string; display_phone_number: string }
  logger: bp.Logger
}

/**
 * Best-effort forwarder for delivery status events. Same gating as the inbound forwarder.
 */
export async function forwardStatus(params: ForwardStatusParams): Promise<void> {
  const { url, apiKey, phone, status, metadata, logger } = params

  if (!url || !apiKey) {
    return
  }

  if (!(await isInboundForwardingEnabled(phone, logger))) {
    return
  }

  const envelope = buildStatusEnvelope(status, metadata, logger)
  await postEnvelope(url, apiKey, envelope, logger, 'WhatsApp delivery status')
}
