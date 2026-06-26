import statsig from 'statsig-node'
import * as bp from '.botpress'

let initialized = false

export async function isGateEnabled(gateName: string, userID: string, logger: bp.Logger): Promise<boolean> {
  const apiKey = bp.secrets.STATSIG_API_KEY
  if (!apiKey) {
    return false
  }

  try {
    if (!initialized) {
      await statsig.initialize(apiKey)
      initialized = true
    }
    return statsig.checkGateSync({ userID }, gateName)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.forBot().error(`Failed to evaluate feature gate "${gateName}": ${message}`)
    return false
  }
}
