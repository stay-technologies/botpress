import statsig from 'statsig-node'
import * as bp from '.botpress'

export const INBOUND_FORWARDING_GATE = 'botpress-whatsapp-events-forwarding'

let initialized = false

export async function isInboundForwardingEnabled(phone: string, logger: bp.Logger): Promise<boolean> {
  const apiKey = bp.secrets.STATSIG_API_KEY
  if (!apiKey) {
    return false
  }

  try {
    if (!initialized) {
      await statsig.initialize(apiKey)
      initialized = true
    }
    return statsig.checkGateSync({ userID: phone }, INBOUND_FORWARDING_GATE)
  } catch (error) {
    logger.forBot().error(`Failed to evaluate inbound forwarding feature toggle: ${error}`)
    return false
  }
}
