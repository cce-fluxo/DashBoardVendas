-- 0012_detalhes_do_contrato.sql
--
-- Guarda contratante, data de assinatura e item da carta.
--
-- `sync-sheets.ts` já lia esses campos da aba Contratos e os descartava. O
-- painel de TV ("Últimos fechados") precisa do cliente e da ordem dentro do
-- mês — `mes_venda` sozinho empata todos os contratos do mesmo mês.
--
-- Todas opcionais: `Contratante` só existe a partir de 25/26, e data ilegível
-- vira NULL com motivo em ingestao_rejeicao, sem descartar o contrato.
--
-- ORDEM DE APLICAÇÃO: esta migration antes do deploy (o upsert passa a mandar as
-- colunas), depois `npx tsx scripts/backfill-sheets.ts` para preencher as
-- gestões passadas.

BEGIN;

ALTER TABLE public.projeto_vendido
	ADD COLUMN IF NOT EXISTS contratante     text,
	ADD COLUMN IF NOT EXISTS data_assinatura date,
	ADD COLUMN IF NOT EXISTS item_da_carta   text;

COMMIT;
