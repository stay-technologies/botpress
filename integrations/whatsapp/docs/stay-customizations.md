# Customizações Stay — `whatsapp-stay`

Detalhamento do que o fork adiciona sobre a integração oficial `whatsapp` do Botpress.
Doc de referência do [CLAUDE.md](../CLAUDE.md) — features de produto (Flows, BSUID) e passo a passo de deploy vivem no [README.md](../README.md).

## Mapa dos módulos custom

| Capability | Código | Ticket |
|---|---|---|
| WhatsApp Flows (`startFlow`) | [`src/actions/start-flow.ts`](../src/actions/start-flow.ts) | FOU-* |
| Identidade por BSUID | [`src/misc/bsuid-extraction.ts`](../src/misc/bsuid-extraction.ts), [`src/misc/identifier-decision.ts`](../src/misc/identifier-decision.ts) | FOU-320/328/339 |
| Forwarding p/ Darwin | [`src/misc/darwin-inbound-forwarding.ts`](../src/misc/darwin-inbound-forwarding.ts) | FOU-541/530 |
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

Secrets usados: `DARWIN_INBOUND_URL`, `DARWIN_API_KEY` (ver bloco `secrets` em [`integration.definition.ts`](../integration.definition.ts)).

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
