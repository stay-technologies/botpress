import { RuntimeError } from '@botpress/sdk'

type RecipientTags = {
  userPhone?: string
  bsuid?: string
}

export type SendRecipient = { phone: string } | { bsuid: string }

export class MissingWhatsAppRecipientError extends RuntimeError {
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

export const buildConversationTags = (input: {
  botPhoneNumberId: string
  userPhone?: string
  bsuid?: string
}): Record<string, string> => {
  const tags: Record<string, string> = { botPhoneNumberId: input.botPhoneNumberId }
  if (input.userPhone) tags.userPhone = input.userPhone
  if (input.bsuid) tags.bsuid = input.bsuid
  return tags
}
