import { startConversation } from './start-conversation'
import { startFlow } from './start-flow'
import { startTypingIndicator, stopTypingIndicator } from './typing-indicator'
import * as bp from '.botpress'

export default {
  startConversation,
  startFlow,
  startTypingIndicator,
  stopTypingIndicator,
} as const satisfies bp.IntegrationProps['actions']
