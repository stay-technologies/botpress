import { getDelegationSecrets } from '../misc/darwin-forwarding-secrets'
import { requestDelegation } from '../misc/darwin-handoff'
import * as bp from '.botpress'

// Handoff (FOU-1287): the card only asks and returns; the flow waits on a "wait for user input" card.
export const delegateToDarwin: bp.IntegrationProps['actions']['delegateToDarwin'] = async ({
  client,
  input,
  logger,
}) => {
  const { conversationId, sectionId, tenant } = input
  let phoneNumber: string | undefined
  try {
    const { conversation } = await client.getConversation({ id: conversationId })
    phoneNumber = conversation.tags.userPhone
  } catch {
    phoneNumber = undefined
  }
  const delegated = await requestDelegation({
    ...getDelegationSecrets(),
    tenant,
    conversationId,
    sectionId,
    phoneNumber,
    logger,
  })
  return { delegated }
}
