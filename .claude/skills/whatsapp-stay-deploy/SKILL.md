---
name: whatsapp-stay-deploy
description: >
  Guia o deploy da integração privada whatsapp-stay (@stay/whatsapp-stay) no
  workspace do Botpress: bump de versão, checks, build, dry-run e deploy real,
  com um gate obrigatório de permissão explícita do dev antes do publish. Use
  quando: deploy whatsapp, publicar whatsapp-stay, subir versão da integração
  whatsapp, deploy da integração whatsapp, bp deploy whatsapp.
---

# whatsapp-stay-deploy

Runbook executável para publicar uma nova versão de `integrations/whatsapp`
(`@stay/whatsapp-stay`). O detalhe canônico (login, PAT, workspace ID, secrets,
upgrade dos bots, rollback) está em [`../../../integrations/whatsapp/README.md`](../../../integrations/whatsapp/README.md).

## 🚨 Gate inegociável

**NUNCA rode `bp deploy` sem `--dryRun` sem autorização EXPLÍCITA do dev, para cada deploy.**
Publish é irreversível (não há *unpublish*) e afeta o workspace inteiro.
Autorização de um deploy anterior NÃO vale para o próximo. Na dúvida, PARE e pergunte.

## Passos

Todos os comandos rodam a partir de `integrations/whatsapp`.

1. **Confirme o alvo.** `bp profiles active` — o workspace precisa ser o correto
   (sandbox vs produção). Deploy no workspace errado é o erro mais comum. Se estiver
   errado, `bp profiles use <perfil>` antes de continuar.
2. **Bump de versão** em `integration.definition.ts` (`INTEGRATION_VERSION`), SemVer:
   patch = bugfix, minor = feature retrocompatível, major = breaking no contrato.
   Deploy com versão já publicada falha no servidor.
3. **Checks verdes** (não prossiga com qualquer um vermelho):
   ```bash
   pnpm run check:type
   pnpm run check:bplint
   pnpm run test
   pnpm run build
   ```
4. **Dry run** (valida sem publicar — precisa passar):
   ```bash
   bp deploy --dryRun --visibility private -y \
     --secrets POSTHOG_KEY=disabled \
     --secrets SANDBOX_CLIENT_SECRET=placeholder \
     --secrets SANDBOX_VERIFY_TOKEN=placeholder \
     --secrets SANDBOX_ACCESS_TOKEN=placeholder \
     --secrets SANDBOX_PHONE_NUMBER_ID=placeholder \
     --secrets STATSIG_API_KEY=placeholder \
     --secrets DARWIN_INBOUND_URL=placeholder \
     --secrets DARWIN_API_KEY=placeholder
   ```
   Se reclamar de secret faltando, adicione ao comando (a lista canônica é o bloco
   `secrets` de `integration.definition.ts`). Se reclamar de versão existente, volte ao passo 2.
5. **⛔ PARE. Peça autorização explícita ao dev para o deploy real.** Só continue com um "sim" claro.
6. **Deploy real** — mesmo comando sem `--dryRun`, com os valores **reais** dos secrets
   (cofre/1Password). Proteja o shell history (`set +o history` ou secrets via env).
7. **Pós-deploy:** avise os donos dos bots — o upgrade da versão em cada bot é **manual**
   (Studio ou bot-as-code). Ver README → "Pós-deploy: upgrade nos bots".

## Rollback

Não há unpublish. Reverta fazendo downgrade da referência da integração em cada bot
e publicando um patch com o fix. Detalhe no README → "Rollback".
