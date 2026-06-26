import { describe, test, expect, beforeEach, vi } from 'vitest'
import { isInboundForwardingEnabled, INBOUND_FORWARDING_GATE } from './feature-toggle'

const isGateEnabled = vi.fn()

vi.mock('./statsig', () => ({
  isGateEnabled: (...args: unknown[]) => isGateEnabled(...args),
}))

const PHONE = '5511999999999'

function buildLogger() {
  const error = vi.fn()
  const logger = { forBot: () => ({ error }) }
  return { logger }
}

describe('isInboundForwardingEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('delegates to isGateEnabled with the inbound forwarding gate and the phone as userID', async () => {
    isGateEnabled.mockResolvedValue(true)
    const { logger } = buildLogger()

    await isInboundForwardingEnabled(PHONE, logger as never)

    expect(isGateEnabled).toHaveBeenCalledWith(INBOUND_FORWARDING_GATE, PHONE, logger)
  })

  test('returns the result of isGateEnabled', async () => {
    isGateEnabled.mockResolvedValue(true)
    const { logger } = buildLogger()

    const result = await isInboundForwardingEnabled(PHONE, logger as never)

    expect(result).toBe(true)
  })
})
