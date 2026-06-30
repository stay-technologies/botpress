import { getAuthenticatedWhatsappClient } from 'src/auth'
import { getMessageFromWhatsappMessageId } from 'src/misc/util'
import { Text } from 'whatsapp-api-js/messages'
import { forwardStatus } from '../../misc/darwin-inbound-forwarding'
import { WhatsAppMessageValue, WhatsAppStatusValue } from '../../misc/types'
import * as bp from '.botpress'

// Meta error codes for which a plain-text URL fallback is useful.
// 131053 = Media upload error (Meta rejected the media format/codec).
// 131052 = Media download error (Meta couldn't fetch the URL).
const MEDIA_FAILURE_CODES = new Set([131052, 131053])

// WhatsApp status progression: SENT → DELIVERED → READ. FAILED is terminal.
const STATUS_RANK: Record<string, number> = {
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
}

const _isDuplicateOrStale = (incoming: WhatsAppStatusValue['status'], existing: string | undefined): boolean => {
  const incomingRank = STATUS_RANK[incoming.toUpperCase()] ?? 0
  const existingRank = STATUS_RANK[(existing ?? '').toUpperCase()] ?? 0
  return existingRank >= incomingRank
}

const _getMediaUrlFromPayload = (
  message: { type: string; payload: { [k: string]: any } } | undefined
): string | undefined => {
  if (!message) return undefined
  switch (message.type) {
    case 'audio':
      return message.payload.audioUrl
    case 'video':
      return message.payload.videoUrl
    case 'image':
      return message.payload.imageUrl
    case 'file':
      return message.payload.fileUrl
    default:
      return undefined
  }
}

export const statusHandler = async (
  value: WhatsAppStatusValue,
  messageValue: WhatsAppMessageValue,
  props: bp.HandlerProps
) => {
  const { client, ctx, logger } = props

  // Best-effort forwarding to Darwin runs regardless of whether Botpress has a
  // local message for this wamid: Darwin correlates by its own wamid store and
  // gracefully discards unknown ones, so it must not be gated by the lookup below.
  await forwardStatus({
    url: bp.secrets.DARWIN_INBOUND_URL,
    apiKey: bp.secrets.DARWIN_API_KEY,
    phone: value.recipient_id,
    status: value,
    metadata: messageValue.metadata,
    logger,
  })

  const message = await getMessageFromWhatsappMessageId(value.id, client)
  if (!message) {
    logger
      .forBot()
      .debug(
        `Received WhatsApp "${value.status}" webhook, but there is no corresponding message in Botpress for WhatsApp message ID: ${value.id}`
      )
    return
  }

  const isStale = _isDuplicateOrStale(value.status, message.tags.status)
  if (!isStale) {
    await client.updateMessage({ id: message.id, tags: { status: value.status.toUpperCase() } })
  }

  if (value.recipient_user_id) {
    await client.updateConversation({
      id: message.conversationId,
      tags: { bsuid: value.recipient_user_id },
    })
  }

  switch (value.status) {
    case 'sent':
      await client.createEvent({
        type: 'messageSent',
        conversationId: message.conversationId,
        messageId: message.id,
        payload: {},
      })
      break
    case 'delivered':
      await client.createEvent({
        type: 'messageDelivered',
        conversationId: message.conversationId,
        messageId: message.id,
        payload: {},
      })
      break
    case 'read':
      await client.createEvent({
        type: 'messageRead',
        conversationId: message.conversationId,
        messageId: message.id,
        payload: {},
      })
      break
    case 'failed': {
      const errorDetails =
        value.errors
          ?.map(
            (err) =>
              `${err.title} (${err.code}): ${err.message}${err.error_data?.details ? ` - ${err.error_data.details}` : ''}`
          )
          .join('; ') || 'Unknown error'

      logger
        .forBot()
        .error(
          `WhatsApp message delivery failed. Message ID: ${value.id}, Recipient: ${value.recipient_id}, Errors: ${errorDetails}`
        )

      const mediaErrorCode = value.errors?.find((e) => MEDIA_FAILURE_CODES.has(e.code))?.code
      const mediaUrl = _getMediaUrlFromPayload(message)
      if (!isStale && mediaErrorCode && mediaUrl) {
        try {
          const { conversation } = await client.getConversation({ id: message.conversationId })
          const { botPhoneNumberId, userPhone } = conversation.tags
          if (botPhoneNumberId && userPhone) {
            logger
              .forBot()
              .warn(
                `WhatsApp rejected the ${message.type} (code ${mediaErrorCode}); sending the URL as a plain text fallback to ${userPhone}.`
              )
            const whatsapp = await getAuthenticatedWhatsappClient(client, ctx)
            await whatsapp.sendMessage(botPhoneNumberId, { phone: userPhone }, new Text(mediaUrl))
          }
        } catch (err) {
          logger.forBot().error('Failed to send the plain text URL fallback for the rejected media:', err)
        }
      }

      await client.createEvent({
        type: 'messageFailed',
        conversationId: message.conversationId,
        messageId: message.id,
        payload: {
          error: errorDetails,
        },
      })
      break
    }
  }
}
