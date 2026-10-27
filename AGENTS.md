<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Projeto: Dashboard Comercial Fluxo

Leia `docs/README.md` antes de mudar comportamento. Os pontos que mais causam
erro:

- **As telas leem só o banco.** Rotas em `src/app/api/dashboard/` nunca chamam
  Pipefy nem Google Sheets; só `src/app/api/cron/*` e `/api/dashboard/atualizar`
  vão às fontes.
- **Existe um banco só** (produção). Scripts que escrevem e o botão Atualizar,
  mesmo no ambiente local, mexem em dados reais.
- **Definição única.** Gestões e ciclos ficam em `src/lib/fontes/registry.ts`,
  pipes e fases em `src/lib/fontes/pipes.ts`, coordenações em
  `src/lib/coordenacoes.ts`, a regra de meta em `src/lib/metas-periodo.ts`. Não
  crie cópias.
- **Datas em horário de Brasília** (`src/lib/periodo-gestao.ts`), nunca no fuso
  do servidor.
- **Leitura do Supabase pagina e ordena** (`.range()` + `.order()` pela chave
  primária); o limite é 1.000 linhas por consulta.
- **Rotas de leitura têm cache** (`src/lib/cache.ts`). Rota nova que lê o banco
  usa `cacheado()` e `exigirLeitura()`; código novo que escreve no banco pelo
  Next chama `invalidarDados()` ao terminar.
- **Nenhum descarte silencioso:** dado que não entra grava motivo em
  `ingestao_rejeicao` (`src/lib/ingestao/registro.ts`).
- **Comentários no topo dos arquivos** registram o erro que motivou cada decisão.
  Leia antes de alterar e atualize se mudar o comportamento.
- **Mudança que altera número exibido** segue `docs/operacao.md` ("Mudar uma
  regra de cálculo"), inclusive `VERSAO_CALCULO` quando afeta snapshots.
- **Migrations** são arquivos numerados em `supabase/migrations/`, aplicados à
  mão no SQL Editor.

Antes de concluir uma mudança:

```bash
npm run typecheck && npm run lint && npm test && npm run knip && npm run build
```

Atualize a documentação em `docs/` no mesmo PR quando o comportamento mudar.
