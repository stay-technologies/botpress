import * as bp from '.botpress'
import { isGateEnabled } from './statsig'

export const INBOUND_FORWARDING_GATE = 'botpress-whatsapp-events-forwarding'

export async function isInboundForwardingEnabled(phone: string, logger: bp.Logger): Promise<boolean> {
  return isGateEnabled(INBOUND_FORWARDING_GATE, phone, logger)
}
