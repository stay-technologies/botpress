export type WhatsAppIdentifiers = {
  bsuid: string | undefined
  phone: string | undefined
}

type ContactLike = {
  wa_id?: string
  user_id?: string
}

type StatusLike = {
  recipient_id?: string
  recipient_user_id?: string
}

export const extractContactIdentifiers = (contact: ContactLike): WhatsAppIdentifiers => ({
  bsuid: contact.user_id,
  phone: contact.wa_id,
})

export const extractStatusIdentifiers = (status: StatusLike): WhatsAppIdentifiers => ({
  bsuid: status.recipient_user_id,
  phone: status.recipient_id,
})
