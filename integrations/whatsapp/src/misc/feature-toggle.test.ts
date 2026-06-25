import { describe, test, expect, beforeEach, vi } from 'vitest'

const initialize = vi.fn()
const checkGateSync = vi.fn()

vi.mock('statsig-node', () => ({
  default: {
    initialize: (...args: unknown[]) => initialize(...args),
    checkGateSync: (...args: unknown[]) => checkGateSync(...args),
  },
}))

const secrets = { STATSIG_API_KEY: '' }

vi.mock('.botpress', () => ({
  get secrets() {
    return secrets
  },
}))

const PHONE = '5511999999999'

function buildLogger() {
  const error = vi.fn()
  const logger = { forBot: () => ({ error }) }
  return { logger, error }
}

describe('isInboundForwardingEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    secrets.STATSIG_API_KEY = ''
  })

  test('returns false without calling Statsig when STATSIG_API_KEY is missing', async () => {
    secrets.STATSIG_API_KEY = ''
    const { isInboundForwardingEnabled } = await import('./feature-toggle')
    const { logger } = buildLogger()

    const result = await isInboundForwardingEnabled(PHONE, logger as never)

    expect(result).toBe(false)
    expect(initialize).not.toHaveBeenCalled()
    expect(checkGateSync).not.toHaveBeenCalled()
  })

  test('returns true when gate is on', async () => {
    secrets.STATSIG_API_KEY = 'secret-key'
    checkGateSync.mockReturnValue(true)
    const { isInboundForwardingEnabled, INBOUND_FORWARDING_GATE } = await import('./feature-toggle')
    const { logger } = buildLogger()

    const result = await isInboundForwardingEnabled(PHONE, logger as never)

    expect(result).toBe(true)
    expect(checkGateSync).toHaveBeenCalledWith({ userID: PHONE }, INBOUND_FORWARDING_GATE)
  })

  test('returns false when gate is off', async () => {
    secrets.STATSIG_API_KEY = 'secret-key'
    checkGateSync.mockReturnValue(false)
    const { isInboundForwardingEnabled } = await import('./feature-toggle')
    const { logger } = buildLogger()

    const result = await isInboundForwardingEnabled(PHONE, logger as never)

    expect(result).toBe(false)
  })

  test('returns false and logs when checkGate throws', async () => {
    secrets.STATSIG_API_KEY = 'secret-key'
    checkGateSync.mockImplementation(() => {
      throw new Error('boom')
    })
    const { isInboundForwardingEnabled } = await import('./feature-toggle')
    const { logger, error } = buildLogger()

    const result = await isInboundForwardingEnabled(PHONE, logger as never)

    expect(result).toBe(false)
    expect(error).toHaveBeenCalled()
  })
})
