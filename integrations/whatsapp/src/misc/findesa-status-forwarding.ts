import axios from 'axios'
import { WhatsAppStatusValue } from './types'
import * as bp from '.botpress'

/**
 * Forwarding of WhatsApp delivery statuses to findesa (NOV-1010).
 *
 * findesa sends its reminders through this same number, so it needs the status of every
 * message (sent, delivered, read, failed) and Meta's pricing category. The integration
 * cannot tell which messages are findesa's: every status of the webhook is forwarded,
 * with no Statsig gate, and findesa keeps only the ones it recognizes.
 *
 * findesa stores no phone number and no message text, so only the message id, the status,
 * the timestamp, the pricing category and the error codes leave the integration.
 */
export type FindesaStatus = {
  meta_message_id: string
  status: WhatsAppStatusValue['status']
  /** Unix seconds as a string, exactly as Meta sends it. */
  timestamp: string
  category: string | null
  errors?: { code: number }[]
}

// findesa answers 400 to a list with more than 100 statuses.
const MAX_STATUSES_PER_REQUEST = 100
const POST_TIMEOUT_MS = 3000
// The handler only answers Meta after this returns, so there is no room to wait between
// attempts: one immediate retry covers a transient failure, not a sleeping findesa.
const MAX_ATTEMPTS = 2

function pricingCategory(pricing: unknown): string | null {
  if (!pricing || typeof pricing !== 'object') {
    return null
  }
  const category = (pricing as Record<string, unknown>).category
  return typeof category === 'string' && category !== '' ? category : null
}

/** Pure builder: turns the statuses of a Meta webhook into the findesa contract. */
export function buildFindesaStatuses(statuses: WhatsAppStatusValue[]): FindesaStatus[] {
  return statuses.map((status) => ({
    meta_message_id: status.id,
    status: status.status,
    timestamp: status.timestamp,
    category: pricingCategory(status.pricing),
    ...(status.errors && { errors: status.errors.map(({ code }) => ({ code })) }),
  }))
}

function httpStatusOf(thrown: unknown): number | undefined {
  const status = (thrown as { response?: { status?: unknown } } | undefined)?.response?.status
  return typeof status === 'number' ? status : undefined
}

// 4xx means a mapping (400) or configuration (401) problem: repeating the request cannot fix it.
function isRetryable(thrown: unknown): boolean {
  const status = httpStatusOf(thrown)
  return status === undefined || status >= 500
}

// Only the HTTP status or the error code: axios messages and configs can carry the URL and the token.
function describeFailure(thrown: unknown): string {
  const status = httpStatusOf(thrown)
  if (status !== undefined) {
    return `HTTP ${status}`
  }
  const code = (thrown as { code?: unknown } | undefined)?.code
  return typeof code === 'string' ? code : 'no response'
}

async function postStatuses(url: string, token: string, statuses: FindesaStatus[], logger: bp.Logger): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await axios.post(url, statuses, {
        headers: {
          'x-daily-messages-token': token,
          'Content-Type': 'application/json',
        },
        timeout: POST_TIMEOUT_MS,
      })
      return
    } catch (thrown: unknown) {
      if (attempt < MAX_ATTEMPTS && isRetryable(thrown)) {
        continue
      }
      // The message id is left out on purpose: a wamid encodes the recipient phone.
      logger
        .forBot()
        .error(
          `Failed to forward ${statuses.length} WhatsApp status(es) to findesa after ${attempt} attempt(s): ${describeFailure(thrown)}`
        )
      return
    }
  }
}

export type ForwardStatusesToFindesaParams = {
  url: string | undefined
  token: string | undefined
  statuses: WhatsAppStatusValue[] | undefined
  logger: bp.Logger
}

/**
 * Best-effort forwarder: one request per webhook (split at 100 statuses). Sending the
 * same status twice is safe on the findesa side. Never throws and never rejects.
 */
export async function forwardStatusesToFindesa(params: ForwardStatusesToFindesaParams): Promise<void> {
  const { url, token, statuses, logger } = params

  // Off-by-default case: missing secrets is normal, stay silent.
  if (!url || !token || !statuses?.length) {
    return
  }

  try {
    const body = buildFindesaStatuses(statuses)
    for (let start = 0; start < body.length; start += MAX_STATUSES_PER_REQUEST) {
      await postStatuses(url, token, body.slice(start, start + MAX_STATUSES_PER_REQUEST), logger)
    }
  } catch {
    logger.forBot().error(`Failed to forward ${statuses.length} WhatsApp status(es) to findesa: unexpected error`)
  }
}
