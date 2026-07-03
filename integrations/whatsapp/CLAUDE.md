# CLAUDE.md — Integração `whatsapp-stay`

Fork **privado** da integração oficial `whatsapp` do Botpress, mantido pela Stay
(`@stay/whatsapp-stay`). Mantém todo o comportamento original e adiciona capacidades
de produto (WhatsApp Flows, BSUID) e integração com o **Darwin** (forwarding de eventos).

Este arquivo é um **índice**. O detalhe vive nos docs/arquivos linkados — abra o que for relevant à sua tarefa.

## 🚨 Regra de ouro: NUNCA faça deploy sem permissão explícita do dev

Publicar uma versão é irreversível (não há *unpublish*) e afeta o workspace inteiro.
Você pode editar, buildar, rodar checks e até `--dryRun`. **Deploy real (`bp deploy` sem `--dryRun`)
exige autorização explícita do dev, para cada deploy.** Autorização anterior não vale para o próximo.

## O que este fork adiciona (mapa)

| Capability | Onde | Detalhe |
|---|---|---|
| Action `startFlow` (WhatsApp Flows) | [`src/actions/start-flow.ts`](src/actions/start-flow.ts) | [README §1](README.md#1-action-startflow--envio-de-whatsapp-flows) |
| Identidade por **BSUID** | [`src/misc/bsuid-extraction.ts`](src/misc/bsuid-extraction.ts), [`identifier-decision.ts`](src/misc/identifier-decision.ts) | [README §2](README.md#2-suporte-a-bsuid-business-scoped-user-id) |
| Forwarding p/ **Darwin** (inbound/outbound/status) | [`src/misc/darwin-inbound-forwarding.ts`](src/misc/darwin-inbound-forwarding.ts) | [docs/stay-customizations.md](docs/stay-customizations.md#forwarding-para-o-darwin) |
| Feature toggle via **Statsig** | [`src/misc/feature-toggle.ts`](src/misc/feature-toggle.ts), [`statsig.ts`](src/misc/statsig.ts) | [docs/stay-customizations.md](docs/stay-customizations.md#feature-toggle-statsig) |

Arquitetura das customizações Stay: **[docs/stay-customizations.md](docs/stay-customizations.md)**.
Tudo que não estiver listado aqui vem do upstream `botpress/botpress` — evite divergir sem motivo.

## Estrutura

- `src/actions/` — actions expostas ao bot (inclui `start-flow.ts`).
- `src/channels/` — renderização de mensagens de saída por tipo.
- `src/webhook/handlers/` — entrada dos eventos do Meta (`messages`, `echo`, `status`, `oauth`, `sandbox`). **Pontos onde o forwarding p/ Darwin está plugado.**
- `src/misc/` — utilidades + módulos Stay (BSUID, Darwin, Statsig).
- `integration.definition.ts` — nome, versão, config, **secrets** e schemas. Fonte da verdade do contrato.

## Como fazer alterações

1. Descubra o arquivo pelo mapa acima. Se mexe em forwarding/toggle/identidade, **leia [docs/stay-customizations.md](docs/stay-customizations.md) antes** — há invariantes (best-effort, fail-safe) que precisam ser preservados.
2. Escreva o código seguindo o estilo do entorno. Custom sempre com **teste** (`*.test.ts` ao lado — vitest).
3. Rode localmente, do diretório da integração:
   ```bash
   cd integrations/whatsapp
   pnpm run test          # vitest
   pnpm run check:type    # tsc --noEmit
   pnpm run check:bplint  # bp lint
   pnpm run build         # bp add -y && bp build
   ```
4. Secret novo? Declare em `integration.definition.ts` (bloco `secrets`) e documente no README + no comando de deploy.
5. Regras de teste (do CLAUDE global): **adicionar** testes/asserções é livre; **modificar/remover** setup ou asserções existentes exige autorização do dev.

### Convenções

- Não quebrar o contrato do upstream sem necessidade; mudança de contrato (action/event/config) = bump **major**.
- Toda customização Stay fica isolada em módulo próprio em `src/misc/` e é plugada nos handlers — não espalhe lógica Stay dentro do código herdado.
- Forwarding é **best-effort**: nunca lançar para o hot path do bot.

## Como fazer o deploy

Runbook completo (pré-requisitos, login, bump, dry-run, deploy, upgrade dos bots, rollback):
**[README.md → "Deploy de uma nova versão"](README.md#deploy-de-uma-nova-versão)**.

Fluxo guiado e com o *gate* de permissão embutido: skill **[`whatsapp-stay-deploy`](../../.claude/skills/whatsapp-stay-deploy/SKILL.md)**.

Resumo (o detalhe está no README — não pule etapas):

1. Bump da versão em `integration.definition.ts` (SemVer).
2. `check:type` + `check:bplint` + `test` verdes → `pnpm run build`.
3. `bp profiles active` → confirme o **workspace correto**.
4. `bp deploy --dryRun --visibility private -y --secrets ...` → precisa passar.
5. **PARE e peça autorização explícita ao dev.**
6. Só então `bp deploy --visibility private -y --secrets <reais>`.
7. Avise os donos dos bots (upgrade não é automático).

> Deploy publica no **workspace**, não nos bots. Cada bot faz upgrade manual da versão.
