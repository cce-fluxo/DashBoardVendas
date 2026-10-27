# Operação: procedimentos do dia a dia

Passo a passo para as tarefas que se repetem. Antes de qualquer uma, vale saber:

> **Existe um banco só.** O mesmo Supabase atende produção, deploys de preview e
> o desenvolvimento local. Rodar um script que escreve, clicar em Atualizar num
> preview ou no `localhost` mexe nos dados de produção.

## Rodar localmente

Requisitos: Node.js 20.9 ou superior e acesso às credenciais (cofre de senhas da
empresa).

1. `npm install`
2. Crie `.env.local` na raiz (já está no `.gitignore`):

   ```
   SUPABASE_URL=
   SUPABASE_SERVICE_ROLE_KEY=
   PIPEFY_TOKEN=
   GOOGLE_SERVICE_ACCOUNT_EMAIL=
   GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   CRON_SECRET=
   ```

3. `npm run dev` e abra <http://localhost:3000>.

O cache das rotas de leitura (`src/lib/cache.ts`) fica em disco em
`.next/dev/cache` e sobrevive a reiniciar o servidor. Depois de mudar um
cálculo ou a base de pessoas, pare o `npm run dev`, rode
`rm -rf .next/dev/cache` e suba de novo. O botão Atualizar também limpa, mas
antes vai às fontes.

Os scripts de `scripts/` leem o mesmo `.env.local`.

## Antes de publicar

```bash
npm run typecheck
npm run lint
npm test
npm run knip
npm run build
```

Os cinco precisam passar sem erro. Se a mudança alterar algum número exibido,
siga também [Mudar uma regra de cálculo](#mudar-uma-regra-de-cálculo).

## Publicar e reverter

- **Publicar:** push (ou merge de PR) na `main` gera o deploy de produção na
  Vercel. Outras branches geram um deploy de **preview** com URL própria, que lê o
  mesmo banco.
- **Reverter:** na Vercel, **Deployments** → escolha o último deploy bom → **⋯** →
  **Promote to Production** (ou **Instant Rollback**). Depois, corrija na `main`.
- Mudanças de variável de ambiente só valem num **deploy novo** (Redeploy).

## Virada de gestão

A gestão avança sozinha em 1º de outubro, mas **só aparece na tela depois de
cadastrada no registry**. Até lá, telas e cron usam a gestão mais recente
cadastrada, e a resposta do cron de planilhas avisa:
*"A gestão vigente é 27/28, mas não há fonte cadastrada para ela"*.

Os cards do Pipefy da gestão nova continuam sendo gravados normalmente; eles só
aparecem quando a gestão existir no registry.

1. **Compartilhe a planilha nova** com o e-mail da conta de serviço
   (`GOOGLE_SERVICE_ACCOUNT_EMAIL`), como **Leitor**.
2. **Pegue o ID** da planilha: o trecho da URL entre `/d/` e `/edit`.
3. **Inspecione** a planilha:

   ```bash
   npx tsx scripts/inspecionar-planilha.ts <spreadsheetId>
   ```

   Ele mostra as abas, a linha de cabeçalho, os nomes exatos das colunas e os
   blocos da aba de metas.
4. **Cadastre a gestão** em `src/lib/fontes/registry.ts`, copiando a entrada da
   gestão anterior e ajustando:
   - `const PLANILHA_2728 = "<spreadsheetId>"`;
   - os **ciclos** (`CICLOS_2728`): `id`, `rotulo`, `mesInicio`, `mesFim`. Se os
     nomes ainda não foram revelados, use `rotuloProvisorio: true`;
   - `contratos.colunas`: os nomes de cabeçalho que a inspeção mostrou;
   - `metas`: colunas dos blocos e âncoras (`METAS`, `total`, `GESTÃO`, `Ciclo`);
   - `observacoes`: qualquer diferença de layout que você notar;
   - o teste de `gestoesDisponiveis` em `src/lib/periodos-disponiveis.test.ts`,
     que lista as gestões esperadas: inclua a nova no topo.

   Os ciclos sem nome ganham um `id` provisório (em 26/27: `ciclo-2`, `ciclo-3`,
   `ciclo-4`). O `id` é a chave das metas no banco; trocá-lo depois é seguro
   enquanto o ciclo não foi congelado.
5. **Valide:**

   ```bash
   npm test
   npx tsx scripts/verificar-registry.ts --gestao 27/28
   ```

   Os testes recusam ciclos com buraco ou sobreposição; o `verificar-registry`
   mostra contratos e metas extraídos da planilha real.
6. **Publique** (merge na `main`).
7. **Carregue:** clique em **Atualizar** (ou espere a próxima carga, a cada 15 min entre 07h e 21h). Para
   conferir antes de gravar:

   ```bash
   npx tsx scripts/backfill-sheets.ts --gestao 27/28 --simular
   npx tsx scripts/registrar-cobertura.ts
   ```

8. **Confira** na tela de Auditoria: carga recente da planilha nova, sem
   rejeições inesperadas.
9. **Ao longo da gestão**, quando cada ciclo ganhar nome, atualize o `rotulo` e
   remova `rotuloProvisorio` (a ingestão avisa quando isso acontece).

## Congelar períodos fechados

O congelamento **não é automático**. Uma vez por mês (por exemplo, no primeiro
dia útil):

```bash
npx tsx scripts/congelar-periodos.ts           # mostra o que congelaria
npx tsx scripts/congelar-periodos.ts --gravar  # grava
```

Um período só fica liberado quando o mês seguinte ao fim dele termina. Exemplo:
a gestão 25/26 e o Ciclo Apollo (fim em 30/09/2026) ficam liberados a partir de
01/11/2026. O script é idempotente: rodar de novo não cria nada se nada novo
fechou. Depois de gravar, clique em **Atualizar** no dashboard para as telas
mostrarem o selo de congelado na hora (o script não consegue limpar o cache).

**Congelado não se refaz.** A tabela recusa UPDATE. Se a planilha de um período
congelado for corrigida, a tela mostra "divergente da fonte", mas o número
congelado continua o que foi reportado.

## Corrigir um dado errado

1. Corrija **na fonte**: na planilha ou no card do Pipefy.
2. Clique em **Atualizar** (ou espere a próxima carga).
3. Confira na tela; em caso de dúvida, use **Auditoria → Conferir um número**
   para ver de qual linha da planilha cada contrato veio.

Não edite as tabelas do banco à mão: a próxima carga sobrescreve, e a edição
quebra a linhagem (`origem_ref`).

## Recarga completa (backfill)

Use quando a interpretação do dado mudou (um campo novo, uma regra de
mapeamento corrigida) ou para reparar o banco.

```bash
npx tsx scripts/backfill-sheets.ts --simular   # lê tudo, não grava
npx tsx scripts/backfill-sheets.ts             # todas as gestões
npx tsx scripts/backfill-pipefy.ts             # todos os pipes (~40 min)
```

`--limpar` **apaga** os dados antes de recarregar. Só use se tiver certeza, e
nunca em `snapshot_periodo` (os backfills não mexem nela). Os dois backfills já
regravam a cobertura no final. Depois, clique em **Atualizar** para as telas
descartarem o cache (ou espere até 30 min).

## Fase ou campo novo no Pipefy

Se alguém criar, renomear ou remover uma fase, a sincronização registra a
rejeição *"fase do pipe ... ausente do MapaPipe"* e a Auditoria mostra.

1. `npx tsx scripts/inspecionar-pipe.ts 306460930` para ver os nomes exatos.
2. Atualize o `MapaPipe` em `src/lib/fontes/pipes.ts` (`fasesComerciais`,
   `fasesTerminais`, `fasesIgnoradas` ou `campos`).
3. `npm test` e publique.
4. Se os cards antigos precisam ser reinterpretados, rode
   `npx tsx scripts/backfill-pipefy.ts --pipe 306460930`.

Um pipe novo é uma entrada nova em `PIPES` e em `COBERTURAS`
(`src/lib/fontes/cobertura.ts`).

## Trocar um segredo

Depois de trocar qualquer variável na Vercel, faça **Redeploy**.

| Segredo | Onde gerar | Onde atualizar | Como testar |
|---|---|---|---|
| `CRON_SECRET` | Qualquer valor longo e aleatório (`openssl rand -hex 32`) | Vercel, `.env.local`, secret do GitHub e Vault: `select vault.update_secret(id, '<novo>') from vault.secrets where name = 'cron_secret';` | `select public.disparar_sync('pipefy');` → `disparo_recente` com 200 |
| `GOOGLE_PRIVATE_KEY` | Google Cloud → IAM → Contas de serviço → Chaves → Adicionar chave (JSON) | Vercel e `.env.local` (valor de `private_key` do JSON) | `npx tsx scripts/verificar-registry.ts` e Atualizar. **Depois exclua a chave antiga** no Google Cloud |
| `PIPEFY_TOKEN` | Pipefy → configurações da conta → Personal access tokens | Vercel e `.env.local` | Atualizar; Auditoria mostra carga do Pipefy sem erro |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API keys | Vercel e `.env.local` | Abrir o dashboard; `npx tsx scripts/auditar-banco.ts` |
| Domínio de produção | Vercel → Domains | Vault `app_base_url` e secret `VERCEL_URL` do GitHub | `select public.url_do_disparo('pipefy');` |

## Aplicar uma migration

1. Crie o próximo arquivo numerado em `supabase/migrations/` (`0018_<assunto>.sql`),
   começando com um comentário que explique o problema e a decisão, como as
   anteriores.
2. Escreva dentro de `BEGIN; ... COMMIT;`.
3. Aplique no **SQL Editor** do Supabase. Não há pipeline automático.
4. Faça o commit do arquivo junto com o código que depende dele.

## Base de pessoas

A mesma pessoa aparece com grafias diferentes entre gestões ("Jonas" em 23/24,
"Jonas Pimenta Thé" em 25/26). A base em `pessoa` e `pessoa_grafia` junta as
grafias (ver [dados.md](dados.md#pessoas)).

**Primeira montagem:**

```bash
npx tsx scripts/sugerir-pessoas.ts                       # só lê; escreve pessoas-sugeridas.csv
# revise o CSV: preencha nome_exibicao onde ligar, e gestao se a grafia só vale numa gestão
npx tsx scripts/sugerir-pessoas.ts --aplicar pessoas-sugeridas.csv   # grava no banco
```

Nomes completos iguais já vêm com `nome_exibicao` preenchido. Apelidos nunca
vêm: o script só sugere candidatos na coluna `sugestao`. O CSV tem nomes de
pessoas e está no `.gitignore`; não suba ele para o repositório (é público).

**Correção do dia a dia:** a Auditoria mostra "Responsáveis sem pessoa na base".
Cadastre a grafia em `pessoa_grafia` pelo Table Editor do Supabase, com o texto
exatamente como a Auditoria mostra. Vale na próxima leitura, sem sync. As telas
têm cache de até 30 min: clique em **Atualizar** para ver na hora.

## Mudar uma regra de cálculo

Para mudanças que alteram números já exibidos (base do funil, definição de
venda, regra de meta):

1. Faça a mudança numa branch, com testes que descrevam a regra nova.
2. **Compare lado a lado** produção e o deploy de preview da branch. Os dois leem
   o mesmo banco, então qualquer diferença vem só do código. Abra o mesmo
   período nos dois (ou chame `/api/dashboard?tipo=...&gestao=...` em cada um) e
   confira os números afetados. Toda diferença precisa ser explicada pela
   mudança. O preview exige login na Vercel com a conta do dashboard (Standard
   Protection).
3. Para períodos **congelados**, a tela de preview passa a mostrar "divergente da
   fonte" se a regra nova der outro resultado; é o esperado, e o número
   congelado não muda.
4. Se a mudança afeta métricas congeladas, suba `VERSAO_CALCULO` em
   `src/lib/snapshots/metricas.ts` e registre o motivo no histórico do comentário.
5. Registre a decisão em [decisoes.md](decisoes.md).

## Conferir a saúde do banco

```bash
npx tsx scripts/auditar-banco.ts
```

Confere invariantes (linhas sem origem, contagens contra a planilha, snapshots
contra a fonte). Somente leitura.
