# Customizações Stay — `whatsapp-stay`

Detalhamento do que o fork adiciona sobre a integração oficial `whatsapp` do Botpress.
Doc de referência do [CLAUDE.md](../CLAUDE.md) — features de produto (Flows, BSUID) e passo a passo de deploy vivem no [README.md](../README.md).

## Mapa dos módulos custom

| Capability | Código | Ticket |
|---|---|---|
| WhatsApp Flows (`startFlow`) | [`src/actions/start-flow.ts`](../src/actions/start-flow.ts) | FOU-* |
| Identidade por BSUID | [`src/misc/bsuid-extraction.ts`](../src/misc/bsuid-extraction.ts), [`src/misc/identifier-decision.ts`](../src/misc/identifier-decision.ts) | FOU-320/328/339 |
| Forwarding p/ Darwin | [`src/misc/darwin-inbound-forwarding.ts`](../src/misc/darwin-inbound-forwarding.ts) | FOU-541/530 |
| Handoff de conversa com o Darwin | [`src/misc/darwin-handoff.ts`](../src/misc/darwin-handoff.ts) | FOU-1287 |
| Feature toggle (Statsig) | [`src/misc/feature-toggle.ts`](../src/misc/feature-toggle.ts), [`src/misc/statsig.ts`](../src/misc/statsig.ts) | FOU-550 |

## Forwarding para o Darwin

O fork encaminha eventos de WhatsApp para o Darwin, em três pontos do webhook:

- **Inbound** (mensagem do usuário) — `forwardInboundMessage`, chamado em [`src/webhook/handlers/messages.ts`](../src/webhook/handlers/messages.ts).
- **Outbound** (echo da mensagem enviada pelo bot/atendente) — `forwardOutboundMessage`, chamado em [`src/webhook/handlers/echo.ts`](../src/webhook/handlers/echo.ts).
- **Status** (sent/delivered/read/failed) — `forwardStatus`, chamado em [`src/webhook/handlers/status.ts`](../src/webhook/handlers/status.ts).

Contrato: `DarwinEnvelope` (`{ source: 'whatsapp', bot, events[] }`), montado por builders puros (`buildInboundEnvelope`, `buildOutboundEnvelope`, `buildStatusEnvelope`).

Regras invioláveis do encaminhamento (ao mexer, **preserve**):

- **Best-effort e fora do hot path.** O POST roda *depois* do processamento do bot e qualquer erro é logado e engolido — nunca lança para o fluxo principal (ver `postEnvelope`). Não transforme forwarding em caminho crítico.
- **Timeout curto** (`POST_TIMEOUT_MS = 3000`). Autenticação via header `X-API-KEY`.
- **Mídia não é baixada** — `content` é o sub-objeto cru por tipo, exatamente como veio do Meta.
- **Timestamp** convertido para ISO-8601 UTC (`toIsoOccurredAt`), com fallback para "agora" logado quando inválido.
- **Motivo da falha de entrega** — o status `failed` leva o `errors[]` da Meta só com `code` e `title` por item. O Darwin responde 400 ao envelope inteiro se um item tiver outro campo, e o status se perde junto.

Secrets usados: `DARWIN_INBOUND_URL`, `DARWIN_API_KEY` (ver bloco `secrets` em [`integration.definition.ts`](../integration.definition.ts)).

## Handoff de conversa com o Darwin

Prova de conceito (FOU-1287): o Darwin assume uma conversa e a devolve. Contrato (tags, rota e respostas) no [README §3](../README.md#3-handoff-de-conversa-com-o-darwin-fou-1287).

- **Dono da conversa** — tag de conversa `handoffOwner` (`isDelegatedToDarwin` em [`darwin-handoff.ts`](../src/misc/darwin-handoff.ts)). Só o valor exato `darwin` desvia; tag ausente ou qualquer outro valor segue o caminho de sempre.
- **Action `delegateToDarwin`** — [`src/actions/delegate-to-darwin.ts`](../src/actions/delegate-to-darwin.ts) é só a casca; a chamada é `requestDelegation` em `darwin-handoff.ts`. Nunca lança: só um `{ delegated: true }` explícito do Darwin conta como delegada. O tenant vai no header `x-execution-tenant`; sem entrada no card usa `DEFAULT_DELEGATION_TENANT` (`TEST`), atalho da prova — antes de produção o card precisa receber o tenant da conversa.
- **Rota `POST /handoff`** — `handoffHandler`, plugado em [`src/webhook/handler.ts`](../src/webhook/handler.ts) antes da validação de assinatura da Meta (que não é tocada). Autenticação pelo header `x-api-key` contra o secret `HANDOFF_API_KEY`; sem o secret configurado a rota recusa tudo.
- **Devolução por mensagem injetada, não por evento** — o fluxo do Studio fica parado num card "esperar resposta do usuário", e o que destrava esse card é mensagem de entrada. Com `handoffResult`, a rota acha o usuário da conversa (`listParticipants`, o participante com a tag `userId`) e cria uma mensagem de entrada falsa em nome dele, com o texto fixo `HANDOFF_RETURNED_TEXT` (`__handoff_returned__`) (`createMessage`, **sem** `origin: 'synthetic'`, que só registra histórico e não aciona o fluxo), marcada com a tag de mensagem `handoffReturn`.
- **Ordem tag → mensagem** — primeiro `updateConversation` (as duas tags), depois a mensagem. Não inverta: se a mensagem falhar, a conversa já voltou para o bot.
- **Typing indicator** — a mensagem injetada não tem `wamid`; [`typing-indicator.ts`](../src/actions/typing-indicator.ts) pula o indicador para ela (`isHandoffReturnMessage`) em vez de falhar.
- **Desvio** — em [`messages.ts`](../src/webhook/handlers/messages.ts), depois do `markAsRead` e do `getOrCreateConversation`: conversa delegada não chama `_handleMessage` nem cria usuário/mensagem no Botpress.
- **Repasse da conversa delegada** — `forwardDelegatedInboundMessage`: aqui o Darwin é o **único** destinatário, então **não** é best-effort gated: ignora a flag do Statsig, tenta de novo uma vez e, persistindo a falha, registra erro com o `wamid`. Continua sem lançar.
- **Relógio de inatividade** — o SDK não oferece um jeito de marcar a conversa como ativa sem entregar mensagem ou evento ao bot; nada foi implementado.

Secrets usados: `HANDOFF_API_KEY`, `DARWIN_DELEGATION_URL`, `CHATBOT_BFF_API_KEY`.

## Feature toggle (Statsig)

O inbound forwarding é *gated* pela flag Statsig `botpress-whatsapp-events-forwarding`
(constante `INBOUND_FORWARDING_GATE` em [`feature-toggle.ts`](../src/misc/feature-toggle.ts)).

- `isGateEnabled(gate, userID, logger)` em [`statsig.ts`](../src/misc/statsig.ts) inicializa o SDK sob demanda.
- Sem `STATSIG_API_KEY` a gate **retorna `false`** (fail-safe: não encaminha).
- O `userID` avaliado é o telefone do usuário.

## Identidade: telefone x BSUID

A oficial só endereça por número. O fork adiciona o **BSUID** (Business-Scoped User ID, `{ISO 3166}.{alfanumérico}`):

- `extractContactIdentifiers` ([`bsuid-extraction.ts`](../src/misc/bsuid-extraction.ts)) tira `{ bsuid, phone }` de contatos/status do webhook.
- `chooseSendRecipient` / `buildConversationTags` ([`identifier-decision.ts`](../src/misc/identifier-decision.ts)) decidem o destinatário ao enviar: usa `userPhone` se houver, senão `bsuid`. Sem nenhum dos dois → `MissingWhatsAppRecipientError`.
- `bsuid` é persistido como tag de `user` e de `conversation`.

Contexto de produto em [README.md](../README.md#2-suporte-a-bsuid-business-scoped-user-id).

## WhatsApp Flows (`startFlow`)

Action de primeira classe para disparar Flows nativos do WhatsApp. Contrato de input/output documentado no [README.md](../README.md#1-action-startflow--envio-de-whatsapp-flows). Código em [`start-flow.ts`](../src/actions/start-flow.ts); reusa `chooseSendRecipient` para resolver telefone/BSUID.
