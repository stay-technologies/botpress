import { z, IntegrationDefinition, messages } from '@botpress/sdk'
import { sentry as sentryHelpers } from '@botpress/sdk-addons'
import proactiveConversation from 'bp_modules/proactive-conversation'
import typingIndicator from 'bp_modules/typing-indicator'

export const INTEGRATION_NAME = 'whatsapp-stay'

const MAX_BUTTON_LABEL_LENGTH = 20

const commonConfigSchema = z.object({
  typingIndicatorEmoji: z
    .boolean()
    .default(false)
    .title('Typing Indicator Emoji')
    .describe('Temporarily add an emoji to received messages to indicate when bot is processing message'),
  downloadMedia: z
    .boolean()
    .default(true)
    .title('Download Media')
    .describe(
      'Automatically download media files using the Files API for content access. If disabled, temporary WhatsApp media URLs will be used, which require authentication with a valid access token.'
    ),
  downloadedMediaExpiry: z
    .number()
    .default(24)
    .optional()
    .title('Downloaded Media Expiry')
    .describe(
      'Expiry time in hours for downloaded media files. An expiry time of 0 means the files will never expire.'
    ),
})

const dropdownButtonLabelSchema = z
  .string()
  .max(MAX_BUTTON_LABEL_LENGTH)
  .optional()
  .title('Button Label')
  .describe('Label for the dropdown button')

const startConversationProps = {
  title: 'Start Conversation',
  description:
    'Proactively starts a conversation with a WhatsApp user by sending them a message using a WhatsApp Message Template',
  input: {
    schema: z.object({
      conversation: z.object({
        userPhone: z
          .string()
          .min(1)
          .title('User Phone Number')
          .describe('Phone number of the WhatsApp user to start a conversation with'),
        templateName: z
          .string()
          .min(1)
          .title('Message Template name')
          .describe('Name of the WhatsApp Message Template to start the conversation with'),
        templateLanguage: z
          .string()
          .optional()
          .title('Message Template language')
          .describe(
            'Language of the WhatsApp Message Template to start the conversation with. Defaults to "en" (English)'
          ),
        templateVariablesJson: z
          .string()
          .optional()
          .title('Message Template variables')
          .describe(
            'JSON array representation of variable values to pass to the WhatsApp Message Template (if required by the template)'
          ),
        botPhoneNumberId: z
          .string()
          .optional()
          .title('Bot Phone Number ID')
          .describe('Phone number ID to use as sender (uses the default phone number ID if not provided)'),
      }),
    }),
  },
}

const defaultBotPhoneNumberId = {
  title: 'Default Bot Phone Number ID',
  description: 'Default Phone ID used by the bot for starting conversations',
}

export default new IntegrationDefinition({
  name: INTEGRATION_NAME,
  version: '1.0.7',
  title: 'WhatsApp',
  description: 'Send and receive messages through WhatsApp.',
  icon: 'icon.svg',
  readme: 'hub.md',
  configurations: {
    manual: {
      title: 'Manual Configuration',
      description: 'Manual Configuration, use your own Meta app (for advanced use cases only)',
      schema: z
        .object({
          verifyToken: z
            .string()
            .min(1)
            .secret()
            .title('Verify Token')
            .describe(
              'Token used for verification when subscribing to webhooks on the Meta app (type any random string)'
            ),
          accessToken: z
            .string()
            .min(1)
            .secret()
            .title('Access Token')
            .describe('Access Token from a System Account that has permission to the Meta app'),
          clientSecret: z
            .string()
            .secret()
            .optional()
            .title('Client Secret')
            .describe('Meta app secret used for webhook signature check'),
          defaultBotPhoneNumberId: z
            .string()
            .min(1)
            .title(defaultBotPhoneNumberId.title)
            .describe(defaultBotPhoneNumberId.description),
        })
        .merge(commonConfigSchema),
    },
    sandbox: {
      title: 'Sandbox',
      description: 'Sandbox configuration, for testing purposes only',
      schema: commonConfigSchema,
      identifier: {
        linkTemplateScript: 'sandboxLinkTemplate.vrl',
      },
    },
  },
  configuration: {
    identifier: {
      linkTemplateScript: 'linkTemplate.vrl',
      required: true,
    },
    schema: commonConfigSchema,
  },
  identifier: {
    extractScript: 'extract.vrl',
    fallbackHandlerScript: 'fallbackHandler.vrl',
  },
  channels: {
    channel: {
      title: 'WhatsApp conversation',
      description: 'Conversation between a WhatsApp user and the bot',
      messages: {
        ...messages.defaults,
        text: {
          schema: messages.defaults.text.schema.extend({
            value: z
              .string()
              .optional()
              .title('value')
              .describe('Underlying value of the message, if any (e.g. button payload, list reply payload, etc.)'),
          }),
        },
        dropdown: {
          schema: messages.defaults.dropdown.schema.extend({
            buttonLabel: dropdownButtonLabelSchema,
          }),
        },
        choice: {
          schema: messages.defaults.choice.schema.extend({
            buttonLabel: dropdownButtonLabelSchema,
          }),
        },
        file: {
          schema: messages.defaults.file.schema.extend({
            filename: z.string().optional(),
          }),
        },
      },
      message: {
        tags: {
          id: {
            title: 'Message ID',
            description: 'The WhatsApp message ID',
          },
          reaction: {
            title: 'Reaction',
            description: 'A reaction added to the message',
          },
          replyTo: {
            title: 'Reply To',
            description: 'The ID of the message that this message is a reply to',
          },
        },
      },
      conversation: {
        tags: {
          botPhoneNumberId: {
            title: 'Bot Phone Number ID',
            description: 'WhatsApp Phone Number ID of the bot',
          },
          userPhone: {
            title: 'User Phone Number',
            description: 'Phone number of the WhatsApp user having a conversation with the bot.',
          },
        },
      },
    },
  },
  user: {
    tags: {
      userId: {
        title: 'User ID',
        description: 'WhatsApp user ID',
      },
      name: {
        title: 'Name',
        description: 'WhatsApp user display name',
      },
    },
  },
  actions: {
    startConversation: {
      ...startConversationProps,
      output: {
        schema: z.object({
          conversationId: z.string().title('Conversation ID').describe('ID of the conversation created'),
        }),
      },
    },
    startFlow: {
      title: 'Start Flow',
      description: 'Sends an Interactive Flow message to a WhatsApp user',
      input: {
        schema: z.object({
          conversation: z.object({
            userPhone: z
              .string()
              .min(1)
              .title('User Phone Number')
              .describe('Phone number of the WhatsApp user to start a conversation with'),
            botPhoneNumberId: z
              .string()
              .optional()
              .title('Bot Phone Number ID')
              .describe('Phone number ID to use as sender (uses the default phone number ID if not provided)'),
          }),
          bodyText: z.string().min(1).title('Body Text').describe('Text body to show above the Flow CTA'),
          flow: z
            .object({
              flowId: z.string().optional().title('Flow ID').describe('Unique ID of the Flow provided by WhatsApp'),
              flowName: z
                .string()
                .optional()
                .title('Flow Name')
                .describe('Flow name provided by the business as an alternative to Flow ID'),
              flowCta: z
                .string()
                .min(1)
                .max(20)
                .title('Flow CTA')
                .describe('Text on the CTA button (max 20 characters, no emoji)'),
              flowToken: z
                .string()
                .optional()
                .title('Flow Token')
                .describe('Business-generated token for identifying the Flow execution'),
              mode: z
                .enum(['published', 'draft'])
                .optional()
                .title('Mode')
                .describe('Whether the Flow is in published or draft mode'),
              flowAction: z
                .enum(['navigate', 'data_exchange'])
                .optional()
                .default('navigate')
                .title('Flow Action')
                .describe('Type of Flow interaction'),
              screen: z
                .string()
                .optional()
                .title('First Screen ID')
                .describe('Required when Flow Action is "navigate"'),
              dataJson: z
                .string()
                .optional()
                .title('Initial Data JSON')
                .describe('Non-empty JSON object passed to the first screen when navigating'),
            })
            .refine((v) => !!v.flowId || !!v.flowName, {
              message: 'Provide either Flow ID or Flow Name',
              path: ['flowId'],
            }),
        }),
      },
      output: {
        schema: z.object({
          conversationId: z.string().title('Conversation ID').describe('ID of the conversation used/created'),
        }),
      },
    },
  },
  events: {
    reactionAdded: {
      title: 'Reaction Added',
      description: 'Triggered when a user adds a reaction to a message',
      schema: z.object({
        reaction: z.string().title('Reaction').describe('The reaction that was added'),
        messageId: z.string().title('Message ID').describe('ID of the message that was reacted to'),
        userId: z.string().optional().title('User ID').describe('ID of the user who added the reaction'),
        conversationId: z.string().optional().title('Conversation ID').describe('ID of the conversation'),
      }),
    },
    reactionRemoved: {
      title: 'Reaction Removed',
      description: 'Triggered when a user removes a reaction from a message',
      schema: z.object({
        reaction: z.string().title('Reaction').describe('The reaction that was removed'),
        messageId: z.string().title('Message ID').describe('ID of the message that was reacted to'),
        userId: z.string().optional().title('User ID').describe('ID of the user who removed the reaction'),
        conversationId: z.string().optional().title('Conversation ID').describe('ID of the conversation'),
      }),
    },
  },
  states: {
    credentials: {
      type: 'integration',
      schema: z.object({
        accessToken: z
          .string()
          .optional()
          .title('Access token')
          .describe('Access token used to authenticate requests to the WhatsApp Business Platform API'),
        defaultBotPhoneNumberId: z
          .string()
          .optional()
          .title(defaultBotPhoneNumberId.title)
          .describe(defaultBotPhoneNumberId.description),
        wabaId: z
          .string()
          .optional()
          .title('WhatsApp Business Account ID')
          .describe('WhatsApp Business Account ID used to subscribe to webhook events'),
      }),
    },
  },
  secrets: {
    ...sentryHelpers.COMMON_SECRET_NAMES,
    CLIENT_ID: {
      description: 'The client ID of the OAuth Meta app',
    },
    CLIENT_SECRET: {
      description: 'The client secret of the OAuth Meta app.',
    },
    OAUTH_CONFIG_ID: {
      description: 'The OAuth configuration ID for the OAuth Meta app',
    },
    VERIFY_TOKEN: {
      description: 'The verify token for the OAuth Meta App Webhooks subscription',
    },
    ACCESS_TOKEN: {
      description: 'Access token for the internal Meta App',
    },
    NUMBER_PIN: {
      description: '6 Digits Pin used for phone number registration',
    },
    SANDBOX_CLIENT_SECRET: {
      description: 'The client secret of the Sandbox Meta app',
    },
    SANDBOX_VERIFY_TOKEN: {
      description: 'The verify token for the Sandbox Meta App Webhooks subscription',
    },
    SANDBOX_ACCESS_TOKEN: {
      description: 'Access token for the Sandbox Meta App',
    },
    SANDBOX_PHONE_NUMBER_ID: {
      description: 'Phone number ID of the Sandbox WhatsApp Business profile',
    },
    SEGMENT_KEY: {
      description: 'Tracking key for general product analytics',
      optional: true,
    },
  },
  entities: {
    proactiveConversation: {
      title: 'Proactive Conversation',
      description: 'Proactive conversation with a WhatsApp user',
      schema: startConversationProps.input.schema.shape['conversation'],
    },
  },
})
  .extend(typingIndicator, () => ({ entities: {} }))
  .extend(proactiveConversation, ({ entities }) => ({
    entities: {
      conversation: entities.proactiveConversation,
    },
    actions: {
      getOrCreateConversation: {
        name: 'startConversation',
        title: startConversationProps.title,
        description: startConversationProps.description,
      },
    },
  }))
