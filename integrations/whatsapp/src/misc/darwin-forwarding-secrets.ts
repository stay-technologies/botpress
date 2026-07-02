import * as bp from '.botpress'

/**
 * Safe accessor for the Darwin forwarding secrets. The generated `bp.secrets` getters
 * THROW when the underlying env var is missing — reading them inline at a call site
 * would crash the message send path in any environment where forwarding is simply not
 * configured (sandbox, new workspace, secret rotation).
 *
 * Kept in its own module (instead of darwin-inbound-forwarding.ts) so the forwarding
 * unit tests never pull `.botpress` at runtime.
 */
export function getDarwinForwardingSecrets(): { url: string | undefined; apiKey: string | undefined } {
  let url: string | undefined
  let apiKey: string | undefined
  try {
    url = bp.secrets.DARWIN_INBOUND_URL
  } catch {
    url = undefined
  }
  try {
    apiKey = bp.secrets.DARWIN_API_KEY
  } catch {
    apiKey = undefined
  }
  return { url, apiKey }
}
