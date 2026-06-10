import { test, expect } from 'vitest'
import {
  chooseSendRecipient,
  MissingWhatsAppRecipientError,
} from './identifier-decision'

test('chooseSendRecipient: prefers phone when both are present', () => {
  const result = chooseSendRecipient({ userPhone: '5511999999999', bsuid: 'BR.X' })
  expect(result).toEqual({ phone: '5511999999999' })
})

test('chooseSendRecipient: falls back to bsuid when phone is missing', () => {
  const result = chooseSendRecipient({ bsuid: 'BR.X' })
  expect(result).toEqual({ bsuid: 'BR.X' })
})

test('chooseSendRecipient: uses phone when only phone is present', () => {
  const result = chooseSendRecipient({ userPhone: '5511999999999' })
  expect(result).toEqual({ phone: '5511999999999' })
})

test('chooseSendRecipient: throws MissingWhatsAppRecipientError when neither is present', () => {
  expect(() => chooseSendRecipient({})).toThrow(MissingWhatsAppRecipientError)
})

test('chooseSendRecipient: throws MissingWhatsAppRecipientError when both are empty strings', () => {
  expect(() => chooseSendRecipient({ userPhone: '', bsuid: '' })).toThrow(MissingWhatsAppRecipientError)
})

test('chooseSendRecipient: falls back to bsuid when phone is an empty string', () => {
  const result = chooseSendRecipient({ userPhone: '', bsuid: 'BR.X' })
  expect(result).toEqual({ bsuid: 'BR.X' })
})
