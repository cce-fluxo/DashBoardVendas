-- supabase/migrations/0001_baseline.sql
--
-- BASELINE — retrato do schema em produção em 01/08/2026.
--
-- Reconstruído a partir de (a) export de tabelas do painel do Supabase e
-- (b) `select tablename, indexname, indexdef from pg_indexes where schemaname='public'`.
-- Não veio de `pg_dump`, então NÃO cobre: políticas de RLS, grants, triggers,
-- funções, extensões, nem o valor corrente das sequences.
--
-- PROPÓSITO: congelar o ponto de partida. Este arquivo descreve o banco COMO ELE
-- É, incluindo os defeitos conhecidos — eles estão comentados com `PROBLEMA`,
-- não corrigidos. Correções entram como migrations numeradas a partir de 0002,
-- para que o histórico mostre o que mudou e quando.
--
-- VERIFICAÇÃO: aplicar num banco vazio e comparar o `pg_indexes` resultante com
-- o de produção. Divergência aqui significa que este retrato está incompleto.

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- vendedor
-- ─────────────────────────────────────────────────────────────────
-- `serial` recria a sequence com o mesmo nome observado em produção
-- (vendedor_id_vendedor_seq), mantendo o retrato fiel.

CREATE TABLE public.vendedor (
	id_vendedor    serial PRIMARY KEY,
	nome_vendedor  character varying NOT NULL UNIQUE
);

-- PROBLEMA (F5): sem tabela de identidade, o mesmo indivíduo registrado como
-- apelido em 23/24 ("Fulano") e nome completo em 25/26 vira duas linhas.
-- Decisão do dono: não haverá reconciliação — nome não identificável é vendedor
-- distinto. A limitação deve ficar visível na UI.

-- ─────────────────────────────────────────────────────────────────
-- projeto_vendido
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE public.projeto_vendido (
	id_projeto       serial PRIMARY KEY,
	mes_venda        date NOT NULL,
	nome_projeto     character varying NOT NULL,
	assinado         boolean NOT NULL DEFAULT false,
	coordenacao      text NOT NULL
		CHECK (coordenacao = ANY (ARRAY['CCE','ACE','MNP','QAB','PRO']::text[])),
	valor_contrato   double precision NOT NULL,
	canal_aquisicao  character varying,
	fidelizacao      boolean NOT NULL DEFAULT false,
	-- PROBLEMA (F1): DEFAULT silencioso. Linha sem gestão explícita entra como
	-- 24/25 sem ninguém perceber.
	gestao           text NOT NULL DEFAULT '24/25'
);

-- Casa com o `onConflict: "nome_projeto,gestao"` do código — este upsert funciona.
-- PROBLEMA (F5): a chave é o NOME do projeto. Dois projetos homônimos na mesma
-- gestão colidem e viram um só, silenciosamente.
CREATE UNIQUE INDEX uq_projeto_gestao
	ON public.projeto_vendido USING btree (nome_projeto, gestao);

CREATE INDEX idx_projeto_mes_venda
	ON public.projeto_vendido USING btree (mes_venda);

-- FALTANDO (F3): não há índice que sirva a um filtro só por `gestao`.
-- uq_projeto_gestao começa por nome_projeto, então não atende. Quando a leitura
-- migrar do Sheets para o banco, as consultas vão filtrar por gestão.

-- ─────────────────────────────────────────────────────────────────
-- projeto_vendedor  (N:N)
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE public.projeto_vendedor (
	id_projeto   integer NOT NULL REFERENCES public.projeto_vendido(id_projeto),
	id_vendedor  integer NOT NULL REFERENCES public.vendedor(id_vendedor),
	PRIMARY KEY (id_projeto, id_vendedor)
);

-- Busca reversa (por vendedor); a PK já cobre o sentido direto.
CREATE INDEX idx_projeto_vendedor_vendedor
	ON public.projeto_vendedor USING btree (id_vendedor);

-- ─────────────────────────────────────────────────────────────────
-- card  (Pipefy)
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE public.card (
	id_card           serial PRIMARY KEY,
	pipefy_id         character varying NOT NULL UNIQUE,
	nome_card         character varying NOT NULL,
	-- PROBLEMA (F6): `timestamp without time zone` descarta o offset. O Pipefy
	-- envia ISO com Z e o projeto ancora todo cálculo em BRT (-03:00, ver
	-- src/lib/periodo-gestao.ts). Ao ler, a string volta sem fuso e o new Date()
	-- do JS a interpreta no fuso local do processo: correto na Vercel (UTC), com
	-- 3h de deslocamento em desenvolvimento (BRT). Deve ser timestamptz.
	data_criacao      timestamp without time zone NOT NULL,
	data_last_update  timestamp without time zone,
	coordenacao       text,
	valor_contrato    double precision,
	canal_aquisicao   character varying,
	etapa_atual       text NOT NULL CHECK (etapa_atual = ANY (ARRAY[
		'Oportunidade',
		'Contato aberto',
		'Pré-diagnóstico feito',
		'Diagnóstico feito',
		'Precificação/Aprovação em andamento',
		'Proposta comercial feita',
		'Follow-up',
		'Venda',
		'Perdido',
		'Pausado'
	]::text[])),
	coordenacoes      text[] DEFAULT '{}'::text[]
);

-- FALTANDO (F6): coluna `pipe_id`. Com dois pipes, não há como saber a
-- procedência de um card nem qual mapa de fases aplicar. (A unicidade de
-- pipefy_id continua válida — os IDs do Pipefy são globais.)

CREATE INDEX idx_card_etapa_atual
	ON public.card USING btree (etapa_atual);

-- REDUNDANTE: card_pipefy_id_key (criado pelo UNIQUE acima) já atende qualquer
-- busca por pipefy_id. Este índice só custa escrita. Candidato a remoção.
CREATE INDEX idx_card_pipefy_id
	ON public.card USING btree (pipefy_id);

-- ─────────────────────────────────────────────────────────────────
-- card_vendedor  (N:N)
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE public.card_vendedor (
	id_card      integer NOT NULL REFERENCES public.card(id_card),
	id_vendedor  integer NOT NULL REFERENCES public.vendedor(id_vendedor),
	PRIMARY KEY (id_card, id_vendedor)
);

CREATE INDEX idx_card_vendedor_vendedor
	ON public.card_vendedor USING btree (id_vendedor);

-- ─────────────────────────────────────────────────────────────────
-- funil  (histórico de transições de fase)
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE public.funil (
	id_funil   serial PRIMARY KEY,
	etapa      text NOT NULL CHECK (etapa = ANY (ARRAY[
		'Oportunidade',
		'Contato aberto',
		'Pré-diagnóstico feito',
		'Diagnóstico feito',
		'Precificação/Aprovação em andamento',
		'Proposta comercial feita',
		'Follow-up',
		'Venda',
		'Perdido',
		'Pausado'
	]::text[])),
	-- PROBLEMA (F6), duplo:
	--   1. sem fuso — mesmo defeito de card.data_criacao, e aqui é pior: este
	--      timestamp é a base de TODO cálculo de conversão e tempo de funil.
	--   2. DEFAULT now() — uma transição que chegue sem timestamp grava "agora"
	--      e INVENTA histórico, numa tabela cujo propósito é ser o registro fiel
	--      do que aconteceu. Deve ser NOT NULL sem default.
	"timestamp"  timestamp without time zone NOT NULL DEFAULT now(),
	id_card    integer NOT NULL REFERENCES public.card(id_card)
);

CREATE INDEX idx_funil_id_card
	ON public.funil USING btree (id_card);

CREATE INDEX idx_funil_etapa
	ON public.funil USING btree (etapa);

CREATE INDEX idx_funil_timestamp
	ON public.funil USING btree ("timestamp");

-- ─────────────────────────────────────────────────────────────────
-- meta
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE public.meta (
	id_meta      serial PRIMARY KEY,
	valor_meta   double precision NOT NULL,
	tipo_meta    text NOT NULL
		CHECK (tipo_meta = ANY (ARRAY['gestao','ciclo','mes']::text[])),
	-- PROBLEMA (F1/F2): este CHECK bloqueia a gestão 23/24 hoje e quebra a
	-- virada para 26/27 em 01/10/2026. Gestão precisa ser dado, não enum.
	gestao_meta  text NOT NULL
		CHECK (gestao_meta = ANY (ARRAY['24/25','25/26']::text[])),
	coordenacao  text
		CHECK (coordenacao = ANY (ARRAY['CCE','ACE','MNP','QAB','PRO']::text[])),
	-- PROBLEMA (F2): guarda o rótulo do período ("Q1") como texto solto, sem
	-- nenhuma definição de quais meses ele cobre. Os ciclos reais têm nome
	-- próprio e duração variável por gestão (Waterloo, Stalingrado, Normandia
	-- em 24/25 — 4 meses cada; Fogo, Forja, Era Industrial, Apollo em 25/26 —
	-- 3 meses cada).
	periodo      text NOT NULL
);

-- NULLS NOT DISTINCT permite coexistirem a meta geral (coordenacao NULL) e as
-- cinco por coordenação no mesmo período.
--
-- PROBLEMA (F0) — CONFIRMADO: `sincronizarMetas` em src/lib/sync-sheets.ts usa
-- `onConflict: "gestao_meta,tipo_meta,periodo"`, SEM coordenacao. Nenhum índice
-- casa com essas três colunas, então o Postgres levanta 42P10 em toda linha e o
-- erro é engolido por um contador. O cron nunca gravou uma única meta; tudo que
-- está na tabela veio do backfill, que usa as quatro colunas corretas.
CREATE UNIQUE INDEX meta_unique_idx
	ON public.meta USING btree (gestao_meta, tipo_meta, periodo, coordenacao)
	NULLS NOT DISTINCT;

COMMIT;
