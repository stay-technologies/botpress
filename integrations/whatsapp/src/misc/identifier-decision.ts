export type RecipientTags = {
  userPhone?: string
  bsuid?: string
}

export type IdentifierPayload = {
  bsuid?: string
  phone?: string
}

export type SendRecipient =
  | { kind: 'phone'; value: string }
  | { kind: 'bsuid'; value: string }

export class MissingWhatsAppRecipientError extends Error {
  public constructor() {
    super(
      "Cannot send WhatsApp message: neither 'userPhone' nor 'bsuid' is set in conversation tags."
    )
    this.name = 'MissingWhatsAppRecipientError'
  }
}

export const chooseSendRecipient = (tags: RecipientTags): SendRecipient => {
  if (tags.userPhone) {
    return { kind: 'phone', value: tags.userPhone }
  }
  if (tags.bsuid) {
    return { kind: 'bsuid', value: tags.bsuid }
  }
  throw new MissingWhatsAppRecipientError()
}

export const hasSufficientIdentifier = (payload: IdentifierPayload): boolean =>
  Boolean(payload.bsuid) || Boolean(payload.phone)
