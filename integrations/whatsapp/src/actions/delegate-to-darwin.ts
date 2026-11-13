import { getDelegationSecrets } from '../misc/darwin-forwarding-secrets'
import { isDelegatedToDarwin, requestDelegation } from '../misc/darwin-handoff'
import * as bp from '.botpress'

// Handoff (FOU-1287): the card only asks and returns; the flow waits on a "wait for user input" card.
export const delegateToDarwin: bp.IntegrationProps['actions']['delegateToDarwin'] = async ({
  client,
  input,
  logger,
}) => {
  const { conversationId, sectionId, tenant } = input
  const readTags = async () => (await client.getConversation({ id: conversationId })).conversation.tags

  let phoneNumber: string | undefined
  try {
    phoneNumber = (await readTags()).userPhone
  } catch (thrown: unknown) {
    const errMsg = thrown instanceof Error ? thrown.message : 'Unknown error thrown'
    logger.forBot().error(`Handoff: could not read conversation ${conversationId}, NOT delegated to Darwin: ${errMsg}`)
    return { delegated: false }
  }

  const delegated = await requestDelegation({
    ...getDelegationSecrets(),
    tenant,
    conversationId,
    sectionId,
    phoneNumber,
    logger,
  })
  if (delegated) {
    return { delegated }
  }

  // The owner tag is the source of truth: Darwin may have taken the conversation even though its
  // answer failed or timed out. Saying "not delegated" then would leave the bot deaf (messages diverted).
  try {
    if (isDelegatedToDarwin(await readTags())) {
      logger.forBot().warn(`Handoff: conversation ${conversationId} is owned by Darwin despite the failed answer`)
      return { delegated: true }
    }
  } catch {
    // keep "not delegated": the failure was already logged by requestDelegation
  }
  return { delegated: false }
}
