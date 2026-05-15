# Integração WhatsApp — `@stay/whatsapp-stay`

Fork interno da integração oficial `whatsapp` do Botpress, mantido pela Stay e publicado de forma **privada** no workspace. Mantém todo o comportamento da integração original (recebimento/envio de mensagens, templates, mídia, typing indicator, proactive conversation, etc.) e adiciona as capacidades abaixo, necessárias para o produto.

## O que esta versão tem a mais

### 1. Action `startFlow` — envio de WhatsApp Flows

Permite disparar uma **mensagem interativa de Flow** (formulários nativos do WhatsApp, multi-tela, com data exchange opcional) a partir do bot. A integração oficial não expõe esse fluxo como ação de primeira classe.

Input principal:
- `conversation.userPhone` — destinatário (e opcionalmente `botPhoneNumberId` para escolher o número de envio).
- `bodyText` — texto exibido acima do botão de CTA.
- `flow.flowId` **ou** `flow.flowName` — identifica o Flow publicado no Meta.
- `flow.flowCta` — rótulo do botão (máx. 20 chars, sem emoji).
- `flow.flowAction` — `navigate` (abre tela específica) ou `data_exchange` (servidor decide a próxima tela).
- `flow.screen` + `flow.dataJson` — tela inicial e payload inicial quando o action é `navigate`.
- `flow.mode` — `published` ou `draft` (útil para testar Flows ainda não publicados).
- `flow.flowToken` — token gerado pelo negócio para correlacionar a execução do Flow.

Saída: `conversationId` da conversa onde o Flow foi enviado.

Use quando o bot precisa coletar dados estruturados do usuário (cadastro, agendamento, formulário) com a UX nativa do WhatsApp em vez de uma troca livre de mensagens.

### 2. Suporte a `bsuid` (Business-Scoped User ID)

A integração oficial trabalha apenas com **número de telefone** como identificador do usuário. Esta versão adiciona suporte ao **BSUID** — o identificador estável por *business portfolio* fornecido pelo Meta, no formato `{ISO 3166}.{alphanumeric}`.

Onde aparece:
- **Tag de `user`** — `bsuid` é persistido como tag do usuário no Botpress, permitindo identificar o mesmo usuário em interações futuras mesmo sem expor o número.
- **Tag de `conversation`** — quando `userPhone` está ausente, a conversa pode ser endereçada via `bsuid`, e a integração usa esse ID como destinatário ao enviar mensagens.

Por que importa:
- Conforme as regras de privacidade do Meta evoluem, nem todo evento traz o número do usuário em claro. O `bsuid` é o identificador canônico recomendado para essas situações.
- Permite tratar o mesmo usuário consistentemente entre conversas/canais dentro do mesmo *business portfolio*.

---

# Deploy de uma nova versão

A partir daqui o documento descreve o passo a passo para publicar uma nova versão da integração `whatsapp-stay` no workspace do Botpress.

> **Importante:** o deploy publica a nova versão **no workspace**, não nos bots. Cada bot que usa a integração continua na versão antiga até que seja feito o **upgrade manual** (via Studio ou CLI). Veja a seção [Pós-deploy: upgrade nos bots](#pós-deploy-upgrade-nos-bots).

---

## 1. Pré-requisitos

- Node.js + `pnpm` (o repo usa `pnpm-workspace.yaml`).
- Acesso ao workspace correto do Botpress Cloud.
- Permissão para publicar integrações privadas nesse workspace.

---

## 2. Instalar a CLI do Botpress

A CLI é o binário `bp`. Pode ser instalada globalmente:

```bash
npm install -g @botpress/cli
# ou
pnpm add -g @botpress/cli
# ou
yarn global add @botpress/cli
```

Verifique a instalação:

```bash
bp --help
bp --version
```

> Alternativamente, é possível usar a CLI versionada do monorepo via `pnpm` (`pnpm --filter @stay/whatsapp-stay exec bp ...`). A versão global é mais simples para deploys pontuais.

---

## 3. Autenticar

A CLI autentica com um **Personal Access Token (PAT)** + um **Workspace ID**. Ambos são amarrados num perfil local (`$BP_BOTPRESS_HOME/profiles.json`, por padrão `~/.botpress/`).

### 3.1 Gerar o Personal Access Token (PAT)

1. Entre no [Botpress Cloud](https://app.botpress.cloud) com a conta que tem acesso ao workspace de deploy.
2. Clique no avatar (canto superior direito) → **Profile Settings** (ou acesse direto `https://app.botpress.cloud/profile/settings`).
3. Vá em **Personal Access Tokens** → **Create Token**.
4. Dê um nome (ex: `cli-deploy-whatsapp`) e copie o token gerado — ele só é exibido uma vez.

> Guarde o PAT no cofre do time (1Password, etc). Ele dá acesso programático à conta inteira.

### 3.2 Descobrir o Workspace ID

Três formas, em ordem de praticidade:

**a) Pela URL do Botpress Cloud (mais rápido):**
- Entre no workspace alvo em `https://app.botpress.cloud`.
- A URL fica no formato `https://app.botpress.cloud/workspaces/<workspaceId>/...`.
- Copie o segmento `<workspaceId>` (UUID).

**b) Pelo Workspace Settings:**
- No workspace alvo → ícone de engrenagem / **Workspace Settings** → **General**.
- O **Workspace ID** aparece na seção de identificação, com botão de copiar.

**c) Pelo próprio `bp login` (interativo):**
- Se você rodar `bp login` sem `--workspaceId`, a CLI lista todos os workspaces vinculados ao PAT e pede para você escolher. O ID escolhido fica salvo no perfil.

### 3.3 Fazer login

Interativo (recomendado na primeira vez):

```bash
bp login
# Prompt 1: Personal Access Token  -> cole o PAT
# Prompt 2: Workspace               -> escolha na lista (a CLI lista os disponíveis)
```

Não-interativo (CI ou re-login direto):

```bash
bp login \
  --token "$BP_TOKEN" \
  --workspaceId "$BP_WORKSPACE_ID"
```

Para confirmar qual workspace/perfil está ativo:

```bash
bp profiles active
bp profiles ls
```

Se houver múltiplos workspaces (ex: sandbox vs produção), use perfis nomeados:

```bash
bp login --profile prod      # cria/atualiza o perfil "prod"
bp login --profile sandbox   # cria/atualiza o perfil "sandbox"
bp profiles use prod         # ativa o perfil "prod"
```

> O `workspaceId` usado no deploy vem do perfil ativo. **Antes de qualquer `bp deploy`, rode `bp profiles active` e confira o workspace.** Deploy no workspace errado é a forma mais comum de "perder" uma versão.

---

## 4. Atualizar a versão da integração

Bump em `integrations/whatsapp/integration.definition.ts`:

```ts
export const INTEGRATION_NAME = 'whatsapp-stay'
export const INTEGRATION_VERSION = '1.2.0' // <- bump aqui
```

Use SemVer:
- **patch** (`1.2.0 → 1.2.1`): bugfix sem mudança de contrato.
- **minor** (`1.2.0 → 1.3.0`): nova capability/feature retrocompatível.
- **major** (`1.2.0 → 2.0.0`): breaking change no contrato (actions/events/config).

> Não pule esse passo. Tentar fazer deploy com uma versão já publicada falha no servidor.

---

## 5. Build

Entre no diretório da integração e rode o build:

```bash
cd integrations/whatsapp
pnpm run build
```

O script `build` (definido no `package.json`) executa:

```bash
bp add -y && bp build
```

- `bp add -y`: instala/atualiza as dependências declaradas em `bpDependencies` (`typing-indicator`, `proactive-conversation`) e gera os módulos em `bp_modules/`.
- `bp build`: compila a integração para o bundle deployável dentro de `.botpress/`.

Antes (ou depois) do build vale rodar:

```bash
pnpm run check:type     # tsc --noEmit
pnpm run check:bplint   # bp lint
pnpm run test           # vitest
```

---

## 6. Dry run

Sempre rode um **dry run** antes do deploy real. Ele valida o pacote contra a API do workspace sem publicar nada:

```bash
bp deploy --dryRun --visibility private -y \
  --secrets POSTHOG_KEY=disabled \
  --secrets SANDBOX_CLIENT_SECRET=placeholder \
  --secrets SANDBOX_VERIFY_TOKEN=placeholder \
  --secrets SANDBOX_ACCESS_TOKEN=placeholder \
  --secrets SANDBOX_PHONE_NUMBER_ID=placeholder
```

Flags importantes:

| Flag | Função |
|------|--------|
| `--dryRun` | Valida o pacote sem publicar. |
| `--visibility private` | Mantém a integração privada do workspace (não vai pro Hub público). |
| `-y` | Confirma prompts automaticamente. |
| `--secrets KEY=VALUE` | Valor placeholder para cada secret declarado em `integration.definition.ts`. No dry run o valor não importa, mas a CLI exige que **todos** os secrets sejam informados. |

Se o dry run reclamar de secret faltando, adicione-o em `--secrets`. Se reclamar de versão já existente, faça o bump (passo 4).

Saída esperada: algo como `Dry run successful. Integration is valid.` Se houver erro, **não prossiga**.

---

## 7. Deploy

Depois que o dry run passou, repita o comando sem `--dryRun` e com os **valores reais** dos secrets (do cofre/1Password/secret manager do time):

```bash
bp deploy --visibility private -y \
  --secrets POSTHOG_KEY=<valor-real> \
  --secrets SANDBOX_CLIENT_SECRET=<valor-real> \
  --secrets SANDBOX_VERIFY_TOKEN=<valor-real> \
  --secrets SANDBOX_ACCESS_TOKEN=<valor-real> \
  --secrets SANDBOX_PHONE_NUMBER_ID=<valor-real>
```

A CLI:
1. Faz upload do bundle.
2. Registra a nova versão da integração no workspace ativo.
3. Retorna o ID e a versão publicada.

> ⚠️ **Cuidado com secrets em shell history.** Use `set +o history` no zsh/bash antes do comando, ou exporte os secrets como variáveis de ambiente e referencie-as (`--secrets POSTHOG_KEY="$POSTHOG_KEY"`).

---

## 8. Pós-deploy: upgrade nos bots

O deploy **não atualiza automaticamente** os bots que já usam a integração. Eles continuam rodando a versão anterior até que cada um faça o upgrade explicitamente.

### Por quê?

Botpress trata integrações como pacotes versionados. Um bot referencia uma versão específica (`whatsapp-stay@1.2.0`). Quando uma nova versão é publicada no workspace (`1.3.0`), o bot continua apontando para `1.2.0` — isso evita que mudanças (especialmente breaking) quebrem bots em produção sem que o time tenha validado.

### Como cada bot atualiza

**Via Studio:**
1. Abrir o bot.
2. Ir em **Integrations** → **WhatsApp**.
3. Clicar em **Upgrade** quando o Studio sinalizar nova versão disponível.
4. Revisar config/secrets (campos novos podem ter sido adicionados) e salvar.
5. Publicar o bot.

**Via código (bots-as-code no monorepo):**
1. Atualizar a referência da integração no `bot.definition.ts` (ou equivalente) para a nova versão.
2. `bp build` + `bp deploy` do bot.

### Comunicação

Após o deploy, avise os donos de bots que usam o `whatsapp-stay` com:
- Versão antiga → nova (`1.2.0 → 1.3.0`).
- Tipo de mudança (patch/minor/major).
- Breaking changes ou novos campos de config obrigatórios, se houver.
- Janela esperada de upgrade.

---

## 9. Rollback

Não há "unpublish" de uma versão deployada. Para reverter:

1. Identifique a última versão estável anterior.
2. Em cada bot afetado, faça o downgrade da referência da integração para essa versão (via Studio ou bot-as-code).
3. Publique uma versão de correção (`patch`) com o bump e o fix, e refaça o ciclo.

Por isso o `--dryRun` e os testes são obrigatórios antes do deploy real.

---

## Checklist rápido

- [ ] `bp` instalado e `bp profiles active` aponta para o workspace correto.
- [ ] Versão bumpada em `integration.definition.ts`.
- [ ] `pnpm run check:type`, `check:bplint` e `test` verdes.
- [ ] `pnpm run build` sem erros.
- [ ] `bp deploy --dryRun ...` verde.
- [ ] `bp deploy ...` com secrets reais, executado.
- [ ] Times donos de bots avisados sobre o upgrade.
