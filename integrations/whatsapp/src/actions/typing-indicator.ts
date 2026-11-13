import { RuntimeError } from '@botpress/client'
import { Reaction } from 'whatsapp-api-js/messages'
import { getAuthenticatedWhatsappClient } from '../auth'
import { isHandoffReturnMessage } from '../misc/darwin-handoff'
import * as bp from '.botpress'

export const startTypingIndicator: bp.IntegrationProps['actions']['startTypingIndicator'] = async ({
  client,
  ctx,
  input,
  logger,
}) => {
  if (ctx.configuration.messageReadBehavior === 'none') {
    return {}
  }
  const whatsapp = await getAuthenticatedWhatsappClient(client, ctx)
  const { conversationId, messageId } = input
  const { botPhoneNumberId, userPhone } = await _getConversationInfos(client, conversationId)
  const { whatsappMessageId } = await _getMessageInfos(client, messageId)
  if (!whatsappMessageId) {
    return {}
  }
  const indicator = ctx.configuration.messageReadBehavior === 'typing_indicator' ? 'text' : undefined

  // No await to avoid blocking
  void whatsapp.markAsRead(botPhoneNumberId, whatsappMessageId, indicator).catch((e) => {
    logger.forBot().error(`Error marking message as read and/or sending typing indicators: ${e ?? '[Unknown error]'}`)
  })
  if (ctx.configuration.typingIndicatorEmoji) {
    void whatsapp
      .sendMessage(botPhoneNumberId, { phone: userPhone }, new Reaction(whatsappMessageId, '👀'))
      .catch((e) => logger.forBot().error(`Error sending typing indicator emoji: ${e ?? '[Unknown error]'}`))
  }
  return {}
}

export const stopTypingIndicator: bp.IntegrationProps['actions']['stopTypingIndicator'] = async ({
  client,
  ctx,
  input,
}) => {
  if (ctx.configuration.messageReadBehavior === 'none' || !ctx.configuration.typingIndicatorEmoji) {
    return {}
  }
  const whatsapp = await getAuthenticatedWhatsappClient(client, ctx)
  const { conversationId, messageId } = input
  const { botPhoneNumberId, userPhone } = await _getConversationInfos(client, conversationId)
  const { whatsappMessageId } = await _getMessageInfos(client, messageId)
  if (!whatsappMessageId) {
    return {}
  }
  await whatsapp.sendMessage(botPhoneNumberId, { phone: userPhone }, new Reaction(whatsappMessageId))
  return {}
}

const _getConversationInfos = async (client: bp.Client, conversationId: string) => {
  const { conversation } = await client.getConversation({
    id: conversationId,
  })
  const { botPhoneNumberId, userPhone } = conversation.tags
  if (!botPhoneNumberId || !userPhone) {
    throw new RuntimeError('Missing tags in conversation tags')
  }
  return { botPhoneNumberId, userPhone }
}

const _getMessageInfos = async (client: bp.Client, messageId: string) => {
  const { message } = await client.getMessage({
    id: messageId,
  })
  const { id: whatsappMessageId } = message.tags
  // Handoff (FOU-1287): the injected return message has no wamid — skip the indicator instead of failing.
  if (isHandoffReturnMessage(message.tags)) {
    return { whatsappMessageId: undefined }
  }
  if (!whatsappMessageId) {
    throw new RuntimeError('Missing WhatsApp message id in the message tags')
  }
  return { whatsappMessageId }
}
