-- supabase/migrations/0004_multi_pipe_e_fuso.sql
--
-- Prepara o banco para os DOIS pipes do Pipefy e corrige o fuso dos timestamps
-- (F6 do PLANO-FONTE-DA-VERDADE.md, plano histórico, no repositório privado de arquivo).
--
-- NÃO APLICADA AUTOMATICAMENTE.
--
-- A conversão de fuso ALTERA O TIPO de colunas existentes. Não perde dado — os
-- valores gravados já são UTC —, mas é a mudança mais invasiva até aqui. Leia a
-- justificativa abaixo antes de rodar.

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- 1. Procedência do card
-- ─────────────────────────────────────────────────────────────────
-- São dois pipes: 303819426 ("CRM Fluxo", 1608 cards, 18/12/2023 a 27/06/2025)
-- e 306460930 ("CRM COM", desde 30/06/2025). Eles usam nomes de fase e labels de
-- campo diferentes, então saber de qual pipe o card veio é o que permite
-- escolher o mapa certo na leitura.
--
-- A unicidade de `pipefy_id` CONTINUA válida: os ids do Pipefy são globais —
-- verificado, o pipe antigo usa a faixa 9xxxxxxxx e o novo 14xxxxxxxx, sem
-- nenhuma colisão.

ALTER TABLE public.card
	ADD COLUMN IF NOT EXISTS pipe_id text;

CREATE INDEX IF NOT EXISTS idx_card_pipe
	ON public.card USING btree (pipe_id);

COMMENT ON COLUMN public.card.pipe_id IS
	'Pipe de origem. Define qual MapaPipe interpreta as fases e os campos deste card.';

-- ─────────────────────────────────────────────────────────────────
-- 2. Fuso horário — o defeito mais silencioso do schema
-- ─────────────────────────────────────────────────────────────────
-- `timestamp without time zone` DESCARTA o offset na gravação. O Pipefy manda
-- ISO com Z, então o que está guardado é hora UTC — só que sem dizer isso.
--
-- Na leitura a string volta sem fuso, e `new Date()` a interpreta no fuso LOCAL
-- do processo: correto na Vercel (UTC), com 3 horas de deslocamento em
-- desenvolvimento (BRT). Todo corte de coorte, janela de ciclo e cálculo de
-- tempo de funil depende disso.
--
-- É especialmente perverso porque o projeto ancora tudo em BRT de propósito
-- (src/lib/periodo-gestao.ts) para ser determinístico — e o schema desfazia essa
-- garantia sem avisar.
--
-- `AT TIME ZONE 'UTC'` é a conversão CERTA justamente porque os valores gravados
-- são UTC. Interpretá-los como BRT deslocaria tudo em 3 horas.

ALTER TABLE public.card
	ALTER COLUMN data_criacao TYPE timestamptz
		USING data_criacao AT TIME ZONE 'UTC',
	ALTER COLUMN data_last_update TYPE timestamptz
		USING data_last_update AT TIME ZONE 'UTC';

ALTER TABLE public.funil
	ALTER COLUMN "timestamp" TYPE timestamptz
		USING "timestamp" AT TIME ZONE 'UTC';

-- ─────────────────────────────────────────────────────────────────
-- 3. O default que inventava histórico
-- ─────────────────────────────────────────────────────────────────
-- `funil.timestamp` tinha DEFAULT now(). Uma transição que chegasse sem
-- timestamp era gravada como "agora" — numa tabela cujo propósito inteiro é ser
-- o registro fiel de QUANDO cada mudança de fase aconteceu.
--
-- Sem default, a inserção falha e o problema aparece, em vez de virar um dado
-- plausível e errado.

ALTER TABLE public.funil ALTER COLUMN "timestamp" DROP DEFAULT;

-- ─────────────────────────────────────────────────────────────────
-- 4. Cobertura real de cada fonte
-- ─────────────────────────────────────────────────────────────────
-- Uma fonte não cobre necessariamente todo o período que se pede a ela. O pipe
-- antigo só existe desde 18/12/2023, então a gestão 23/24 (que começa em
-- 01/10/2023) tem funil PARCIAL — faltam outubro, novembro e metade de dezembro.
--
-- Comparar o 1º ciclo de 23/24 com o de 24/25 sem esse aviso produz "o funil
-- encolheu", que é falso: o funil não encolheu, a fonte não existia.
--
-- Registrar a cobertura é o que permite a tela dizer "este período não está
-- inteiramente coberto" em vez de mostrar um número menor sem explicação.

CREATE TABLE public.cobertura_fonte (
	id_cobertura serial PRIMARY KEY,
	fonte_tipo   text NOT NULL,
	fonte_ref    text NOT NULL,
	-- NULL = a cobertura vale para qualquer gestão.
	gestao       text,
	inicio_real  timestamptz NOT NULL,
	-- NULL = ainda em uso, sem fim conhecido.
	fim_real     timestamptz,
	observacao   text,
	UNIQUE (fonte_tipo, fonte_ref, gestao)
);

COMMENT ON TABLE public.cobertura_fonte IS
	'O que cada fonte REALMENTE cobre. Distingue "não aconteceu" de "não foi medido".';

COMMIT;
