-- 0010_identidade_do_contrato.sql
--
-- O nome do projeto deixa de ser a identidade do contrato.
--
-- O QUE ACONTECEU
--
-- `uq_projeto_gestao` era único em (nome_projeto, gestao). O baseline já
-- avisava ("PROBLEMA (F5): dois projetos homônimos na mesma gestão colidem e
-- viram um só, silenciosamente"), e a hora chegou: na planilha de 25/26, 83
-- contratos viravam 81 no banco.
--
--   · "Café Zeta"         — um contrato na PRO e outro na QAB
--   · "PE Projeto Lambda" — um em dez/2025 e outro em set/2026
--
-- Em cada par o upsert sobrescrevia um com o outro. Nenhum erro, nenhum aviso
-- útil — só dois contratos a menos nos totais e o contador de projetos errado.
--
-- A IDENTIDADE PASSA A SER (gestao, nome_projeto, coordenacao, mes_venda)
--
-- Tem de coincidir com `chaveProjeto` em src/lib/fontes/mapear.ts e com o
-- `onConflict` de src/lib/sync-sheets.ts. As linhas que já existem satisfazem
-- o índice novo por construção: eram únicas num conjunto menor de colunas.
--
-- ORDEM DE APLICAÇÃO
--
--   1. Rode esta migration no Supabase.
--   2. Faça o deploy do código que usa a chave nova.
--
-- Entre os dois passos a sincronização das PLANILHAS (o upsert antigo não
-- encontra o índice antigo) devolve erro — e só ela: leitura do dashboard e
-- Pipefy não são afetados. Faça os dois seguidos. Depois do deploy, rode o
-- backfill de 25/26 (`npx tsx scripts/backfill-sheets.ts --gestao 25/26`) para o
-- banco receber os dois contratos que faltavam.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_projeto_identidade
	ON public.projeto_vendido USING btree (gestao, nome_projeto, coordenacao, mes_venda);

-- `uq_projeto_gestao` existe no banco de produção como CONSTRAINT, não como
-- índice solto — `DROP INDEX` recusa (2BP01). Dropar a constraint leva o índice
-- junto. O `DROP INDEX` abaixo cobre um banco montado só pelo baseline, onde ele
-- é índice; num banco onde a constraint já foi removida, é um no-op.
ALTER TABLE public.projeto_vendido DROP CONSTRAINT IF EXISTS uq_projeto_gestao;
DROP INDEX IF EXISTS public.uq_projeto_gestao;

COMMIT;
