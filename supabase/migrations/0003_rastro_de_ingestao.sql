-- supabase/migrations/0003_rastro_de_ingestao.sql
--
-- Linhagem e rejeições (F5 do PLANO-FONTE-DA-VERDADE.md, plano histórico, no repositório privado de arquivo).
--
-- O que este projeto vem tropeçando desde o começo é sempre a mesma coisa:
-- descarte silencioso. O cron que nunca gravou meta nenhuma e engolia o erro num
-- contador; as 343 linhas de fórmula que virariam contratos; a linha "Concepção
-- Tonk One" que apareceu do nada e só foi notada porque alguém reparou num
-- número. Nenhum deles apareceu em lugar nenhum consultável.
--
-- Duas tabelas resolvem isso:
--   ingestao_execucao  — quando rodou, o que leu, quanto entrou, quanto ficou fora
--   ingestao_rejeicao  — o que NÃO virou dado, com motivo e payload cru
--
-- E três colunas de linhagem respondem "de onde veio esta linha".
--
-- NÃO APLICADA AUTOMATICAMENTE. Não destrói dado: só cria tabelas e acrescenta
-- colunas nuláveis.

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- Uma linha por execução de sincronização
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE public.ingestao_execucao (
	id_execucao   serial PRIMARY KEY,

	-- 'sheets' | 'pipefy'
	fonte_tipo    text NOT NULL,
	-- spreadsheetId ou pipeId — de qual fonte concreta se trata
	fonte_ref     text NOT NULL,
	-- Gestão sincronizada. NULL quando a execução não é por gestão (Pipefy).
	gestao        text,

	iniciado_em   timestamptz NOT NULL DEFAULT now(),
	terminado_em  timestamptz,

	-- 'executando' | 'ok' | 'com_erros' | 'falhou'
	--   ok         → nada foi perdido
	--   com_erros  → terminou, mas houve falha de gravação
	--   falhou     → lançou antes de terminar
	status        text NOT NULL DEFAULT 'executando'
		CHECK (status = ANY (ARRAY['executando','ok','com_erros','falhou'])),

	linhas_lidas      integer NOT NULL DEFAULT 0,
	linhas_aceitas    integer NOT NULL DEFAULT 0,
	linhas_rejeitadas integer NOT NULL DEFAULT 0,
	-- Linhas sem substância (fórmula arrastada). Contadas, não rejeitadas.
	linhas_ignoradas  integer NOT NULL DEFAULT 0,
	-- Linhas removidas por terem sumido da fonte (reconciliação).
	linhas_removidas  integer NOT NULL DEFAULT 0,

	-- 'cron' | 'backfill' | 'manual'
	disparado_por text NOT NULL,
	-- Mensagem quando status = 'falhou'.
	erro          text
);

-- A pergunta mais frequente da página de auditoria é "quando esta fonte
-- sincronizou pela última vez, e deu certo?".
CREATE INDEX idx_execucao_fonte_inicio
	ON public.ingestao_execucao USING btree (fonte_tipo, fonte_ref, iniciado_em DESC);

COMMENT ON TABLE public.ingestao_execucao IS
	'Uma linha por rodada de sincronização. Responde "quando este dado foi atualizado e deu certo?".';

-- ─────────────────────────────────────────────────────────────────
-- Uma linha por registro que NÃO virou dado
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE public.ingestao_rejeicao (
	id_rejeicao   serial PRIMARY KEY,
	id_execucao   integer NOT NULL
		REFERENCES public.ingestao_execucao(id_execucao) ON DELETE CASCADE,

	-- Onde estava: '<spreadsheetId>#<aba>#L42' ou '<pipeId>#<cardId>'
	origem_ref    text NOT NULL,
	-- Motivo legível por gente, não código de erro.
	motivo        text NOT NULL,
	-- Campo específico, quando aplicável ('coordenacao', 'projeto'…).
	campo         text,
	-- O que havia na linha. Sem isto, "rejeitada" não dá para investigar.
	payload_bruto jsonb,

	criado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rejeicao_execucao
	ON public.ingestao_rejeicao USING btree (id_execucao);

-- "Esta linha continua pendente há quanto tempo?" — a pergunta que transforma
-- rejeição em algo que alguém conserta, em vez de log que ninguém lê.
CREATE INDEX idx_rejeicao_origem
	ON public.ingestao_rejeicao USING btree (origem_ref, criado_em DESC);

COMMENT ON TABLE public.ingestao_rejeicao IS
	'O que a fonte não pôde fornecer como dado, com motivo e payload. Nenhum descarte silencioso.';

-- ─────────────────────────────────────────────────────────────────
-- Linhagem
-- ─────────────────────────────────────────────────────────────────
-- Nuláveis de propósito: as linhas já existentes não têm procedência conhecida,
-- e inventar uma seria pior que admitir a lacuna. A primeira recarga preenche.

ALTER TABLE public.projeto_vendido
	ADD COLUMN IF NOT EXISTS origem_tipo text,
	ADD COLUMN IF NOT EXISTS origem_ref  text,
	ADD COLUMN IF NOT EXISTS id_execucao integer
		REFERENCES public.ingestao_execucao(id_execucao) ON DELETE SET NULL;

ALTER TABLE public.meta
	ADD COLUMN IF NOT EXISTS origem_tipo text,
	ADD COLUMN IF NOT EXISTS origem_ref  text,
	ADD COLUMN IF NOT EXISTS id_execucao integer
		REFERENCES public.ingestao_execucao(id_execucao) ON DELETE SET NULL;

COMMENT ON COLUMN public.projeto_vendido.origem_ref IS
	'De onde esta linha veio: <spreadsheetId>#<aba>#L<linha>. É o que permite clicar num KPI e chegar na célula.';

COMMENT ON COLUMN public.meta.origem_ref IS
	'Célula de origem, ou "derivado: ..." quando a meta foi calculada (gestão por coordenação em 23/24 e 24/25). Número derivado nunca deve se passar por lido.';

COMMENT ON COLUMN public.projeto_vendido.id_execucao IS
	'Última execução que tocou esta linha.';

-- Índice para o drill-down reverso: "quais linhas esta execução escreveu?"
CREATE INDEX IF NOT EXISTS idx_projeto_execucao
	ON public.projeto_vendido USING btree (id_execucao);

COMMIT;
