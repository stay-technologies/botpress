import { RuntimeError, z } from '@botpress/sdk'
import { getDefaultBotPhoneNumberId, getAuthenticatedWhatsappClient } from '../auth'
import { Interactive, Body, ActionFlow } from 'whatsapp-api-js/messages'
import { forwardSentMessage } from '../misc/darwin-inbound-forwarding'
import { getDarwinForwardingSecrets } from '../misc/darwin-forwarding-secrets'
import { buildConversationTags, chooseSendRecipient } from '../misc/identifier-decision'
import * as bp from '.botpress'

const NonEmptyObjectSchema = z
  .object({})
  .catchall(z.any())
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'Object must not be empty',
  })

export const startFlow = async ({ ctx, input, client, logger }: any) => {
  // Prevent the use of billable resources through the sandbox account
  if (ctx.configurationType === 'sandbox') {
    _logForBotAndThrow('Starting a flow is not supported in sandbox mode', logger)
  }

  const {
    conversation: { userPhone, userBsuid, botPhoneNumberId: maybeBotPhoneNumberId },
    bodyText,
    flow,
  } = input

  if (!userPhone && !userBsuid) {
    _logForBotAndThrow('Either userPhone or userBsuid must be provided', logger)
  }

  const botPhoneNumberId = maybeBotPhoneNumberId
    ? maybeBotPhoneNumberId
    : await getDefaultBotPhoneNumberId(client, ctx).catch(() => {
        _logForBotAndThrow('No default bot phone number ID available', logger)
      })

  const { conversation } = await client.getOrCreateConversation({
    channel: 'channel',
    tags: buildConversationTags({ botPhoneNumberId, userPhone, bsuid: userBsuid }),
  })

  const recipient = chooseSendRecipient({ userPhone, bsuid: userBsuid })

  const whatsapp = await getAuthenticatedWhatsappClient(client, ctx)

  type FlowParams = ConstructorParameters<typeof ActionFlow>[0]

  let idOrName: { flow_id: string; flow_name?: never } | { flow_name: string; flow_id?: never }
  if (flow.flowId) {
    idOrName = { flow_id: flow.flowId }
  } else if (flow.flowName) {
    idOrName = { flow_name: flow.flowName }
  } else {
    _logForBotAndThrow('Either flowId or flowName must be provided', logger)
  }

  const base = {
    flow_message_version: '3' as const,
    flow_cta: flow.flowCta as string,
    ...(flow.flowToken ? { flow_token: flow.flowToken as string } : {}),
    ...(flow.mode ? { mode: flow.mode as 'published' | 'draft' } : {}),
    ...idOrName,
  }

  let parameters: FlowParams
  const flowAction = (flow.flowAction ?? 'navigate') as 'navigate' | 'data_exchange'
  if (flowAction === 'navigate') {
    if (!flow.screen) {
      _logForBotAndThrow('screen must be provided when flowAction is "navigate"', logger)
    }

    let data: unknown | undefined
    if (flow.dataJson) {
      try {
        const parsed = JSON.parse(flow.dataJson)
        // WhatsApp requires a non-empty object if provided
        data = NonEmptyObjectSchema.parse(parsed)
      } catch (err: any) {
        _logForBotAndThrow(
          `Value provided for Flow data JSON isn't valid (error: ${err?.message ?? ''}). Received: ${flow.dataJson}`,
          logger
        )
      }
    }

    parameters = {
      ...base,
      flow_action: 'navigate',
      flow_action_payload: {
        screen: flow.screen,
        ...(data ? { data } : {}),
      },
    }
  } else if (flowAction === 'data_exchange') {
    parameters = {
      ...base,
      flow_action: 'data_exchange',
    }
  } else {
    _logForBotAndThrow('Invalid flowAction provided', logger)
  }

  const interactive = new Interactive(new ActionFlow(parameters), new Body(bodyText))

  const response = await whatsapp.sendMessage(botPhoneNumberId, recipient, interactive)

  if ('error' in response) {
    const errorJSON = JSON.stringify(response.error)
    _logForBotAndThrow(
      `Failed to start WhatsApp flow with flowId "${flow.flowId ?? ''}" flowName "${
        flow.flowName ?? ''
      }" and action "${parameters.flow_action}" - Error: ${errorJSON}`,
      logger
    )
  }

  const wamid = 'messages' in response ? response.messages[0]?.id : undefined
  if (wamid) {
    // Best-effort forwarding to Darwin — never throws into the action path.
    await forwardSentMessage({
      ...getDarwinForwardingSecrets(),
      wamid,
      messageType: 'interactive',
      message: _redactFlowSensitiveFields(interactive),
      recipientPhone: userPhone,
      recipientBsuid: userBsuid,
      botPhoneNumberId,
      logger,
    })
  }

  logger
    .forBot()
    .info(
      `Successfully started WhatsApp flow with flowId "${flow.flowId ?? ''}" flowName "${
        flow.flowName ?? ''
      }" and action "${parameters.flow_action}"`
    )

  return {
    conversationId: conversation.id,
  }
}

function _logForBotAndThrow(message: string, logger: any): never {
  logger.forBot().error(message)
  throw new RuntimeError(message)
}

/**
 * The serialized Interactive carries `action.parameters.flow_token` (session/authorization
 * token validated by the flow's data endpoint) and `flow_action_payload.data` (arbitrary
 * initial screen data, potentially PII). Neither belongs in the Darwin envelope — Meta
 * never echoes them either. Returns a redacted plain-object copy; on any failure returns
 * a minimal marker object so forwarding stays best-effort.
 */
function _redactFlowSensitiveFields(interactive: Interactive): unknown {
  try {
    const plain = JSON.parse(JSON.stringify(interactive))
    const parameters = plain?.action?.parameters
    if (parameters && typeof parameters === 'object') {
      delete parameters.flow_token
      if (parameters.flow_action_payload && typeof parameters.flow_action_payload === 'object') {
        delete parameters.flow_action_payload.data
      }
    }
    return plain
  } catch {
    return { type: 'flow' }
  }
}
