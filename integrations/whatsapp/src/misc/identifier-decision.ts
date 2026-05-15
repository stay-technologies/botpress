export type RecipientTags = {
  userPhone?: string
  bsuid?: string
}

export type IdentifierPayload = {
  bsuid?: string
  phone?: string
}

export type SendRecipient = { phone: string } | { bsuid: string }

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
    return { phone: tags.userPhone }
  }
  if (tags.bsuid) {
    return { bsuid: tags.bsuid }
  }
  throw new MissingWhatsAppRecipientError()
}

export const hasSufficientIdentifier = (payload: IdentifierPayload): boolean =>
  Boolean(payload.bsuid) || Boolean(payload.phone)
