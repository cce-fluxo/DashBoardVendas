-- 0014_faturamento.sql
--
-- Faturamento (o que entrou de fato, mês a mês) e as metas dele, para a tela de
-- Metas da TV (/tv).
--
-- Fonte: a planilha "Fluxo Faturado por Mês" da gestão (registry, campo
-- `faturamento`), que consolida as planilhas de faturamento das coordenações.
-- Ela traz, por mês, o PREVISTO (o que deveria ser faturado) e o REALIZADO.
--
-- POR QUE TABELA PRÓPRIA PARA AS METAS, E NÃO `meta`
--
-- A meta de faturamento não é a meta de vendas: no Ciclo Gambito, a de
-- faturamento da ACE é R$ 84 mil e a de vendas, R$ 54 mil. Guardá-las em `meta`
-- exigiria uma coluna nova no índice único que o sync de vendas usa no upsert —
-- mexer no caminho que já funciona para acomodar o que é novo. A tabela nova
-- tem as MESMAS colunas de `meta`, para o mesmo leitor servir às duas.

BEGIN;

CREATE TABLE IF NOT EXISTS public.faturamento_mes (
	id_faturamento serial PRIMARY KEY,
	gestao       text NOT NULL CHECK (gestao ~ '^\d{2}/\d{2}$'),
	-- NULL = a Fluxo inteira (aba "Visão Geral").
	coordenacao  text CHECK (coordenacao = ANY (ARRAY['CCE','ACE','MNP','QAB','PRO']::text[])),
	-- Primeiro dia do mês.
	mes          date NOT NULL,
	-- NULL = célula ilegível na planilha (o motivo vai para ingestao_rejeicao).
	previsto     double precision,
	realizado    double precision,
	origem_tipo  text,
	origem_ref   text,
	id_execucao  integer REFERENCES public.ingestao_execucao(id_execucao) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS faturamento_mes_unique_idx
	ON public.faturamento_mes USING btree (gestao, coordenacao, mes)
	NULLS NOT DISTINCT;

CREATE TABLE IF NOT EXISTS public.meta_faturamento (
	id_meta      serial PRIMARY KEY,
	valor_meta   double precision NOT NULL,
	tipo_meta    text NOT NULL CHECK (tipo_meta = ANY (ARRAY['gestao','ciclo','mes']::text[])),
	gestao_meta  text NOT NULL CHECK (gestao_meta ~ '^\d{2}/\d{2}$'),
	coordenacao  text CHECK (coordenacao = ANY (ARRAY['CCE','ACE','MNP','QAB','PRO']::text[])),
	periodo      text NOT NULL,
	origem_tipo  text,
	origem_ref   text,
	id_execucao  integer REFERENCES public.ingestao_execucao(id_execucao) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS meta_faturamento_unique_idx
	ON public.meta_faturamento USING btree (gestao_meta, tipo_meta, periodo, coordenacao)
	NULLS NOT DISTINCT;

ALTER TABLE public.faturamento_mes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_faturamento ENABLE ROW LEVEL SECURITY;

COMMIT;
