import statsig from 'statsig-node'
import * as bp from '.botpress'

let initialized = false

// The gate check now also runs in the message send path, so a slow/unreachable Statsig
// must never hang a send indefinitely (the SDK default is no timeout at all).
const INIT_TIMEOUT_MS = 2000

export async function isGateEnabled(gateName: string, userID: string, logger: bp.Logger): Promise<boolean> {
  try {
    // Inside the try: the generated secret getter THROWS when the env var is missing.
    const apiKey = bp.secrets.STATSIG_API_KEY
    if (!apiKey) {
      return false
    }

    if (!initialized) {
      await statsig.initialize(apiKey, { initTimeoutMs: INIT_TIMEOUT_MS })
      initialized = true
    }
    return statsig.checkGateSync({ userID }, gateName)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.forBot().error(`Failed to evaluate feature gate "${gateName}": ${message}`)
    return false
  }
}
