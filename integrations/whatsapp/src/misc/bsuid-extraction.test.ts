import { test, expect } from 'vitest'
import { extractContactIdentifiers, extractStatusIdentifiers } from './bsuid-extraction'

test('extractContactIdentifiers: contact with both wa_id and user_id', () => {
  const result = extractContactIdentifiers({ wa_id: '5511999999999', user_id: 'BR.X' })
  expect(result).toEqual({ bsuid: 'BR.X', phone: '5511999999999' })
})

test('extractContactIdentifiers: contact with only user_id (username active, phone hidden)', () => {
  const result = extractContactIdentifiers({ user_id: 'BR.X' })
  expect(result).toEqual({ bsuid: 'BR.X', phone: undefined })
})

test('extractContactIdentifiers: legacy contact with only wa_id', () => {
  const result = extractContactIdentifiers({ wa_id: '5511999999999' })
  expect(result).toEqual({ bsuid: undefined, phone: '5511999999999' })
})

test('extractContactIdentifiers: empty contact returns both undefined', () => {
  const result = extractContactIdentifiers({})
  expect(result).toEqual({ bsuid: undefined, phone: undefined })
})

test('extractStatusIdentifiers: status with recipient_user_id', () => {
  const result = extractStatusIdentifiers({ recipient_id: '5511999999999', recipient_user_id: 'BR.X' })
  expect(result).toEqual({ bsuid: 'BR.X', phone: '5511999999999' })
})

test('extractStatusIdentifiers: legacy status with only recipient_id', () => {
  const result = extractStatusIdentifiers({ recipient_id: '5511999999999' })
  expect(result).toEqual({ bsuid: undefined, phone: '5511999999999' })
})

test('extractStatusIdentifiers: status with only recipient_user_id (no phone)', () => {
  const result = extractStatusIdentifiers({ recipient_user_id: 'BR.X' })
  expect(result).toEqual({ bsuid: 'BR.X', phone: undefined })
})
