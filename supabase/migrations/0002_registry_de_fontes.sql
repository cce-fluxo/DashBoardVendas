-- supabase/migrations/0002_registry_de_fontes.sql
--
-- Prepara o banco para receber as três planilhas oficiais (F1 do
-- PLANO-FONTE-DA-VERDADE.md, plano histórico, no repositório privado de arquivo). Sem isto, a ingestão da gestão 23/24 falha e o
-- "Valor Vendido real" não tem onde ser gravado.
--
-- NÃO APLICADA AUTOMATICAMENTE. Rode quando decidir iniciar a recarga.
-- Não destrói dado: só afrouxa restrições e acrescenta coluna/índice.

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- 1. Gestão deixa de ser enum
-- ─────────────────────────────────────────────────────────────────
-- O CHECK aceitava só '24/25' e '25/26'. Isso bloqueia a gestão 23/24 hoje e
-- quebraria sozinho em 01/10/2026, quando a vigente virar 26/27.
--
-- A validação passa a viver no registry (src/lib/fontes/), que além do formato
-- confere o calendário de ciclos — coisa que um CHECK não faz.

ALTER TABLE public.meta DROP CONSTRAINT IF EXISTS meta_gestao_meta_check;

-- Formato continua garantido, mas sem lista fechada de valores.
ALTER TABLE public.meta
	ADD CONSTRAINT meta_gestao_formato
	CHECK (gestao_meta ~ '^\d{2}/\d{2}$');

-- ─────────────────────────────────────────────────────────────────
-- 2. Guardar as DUAS colunas de valor
-- ─────────────────────────────────────────────────────────────────
-- A planilha mantém "Valor Vendido real" e "Valor contrato" separados, e eles
-- divergem de verdade (em 23/24, mais de duzentos mil reais). Descartar um na
-- ingestão destrói informação que não volta.
--
-- `valor_vendido_real` é a referência para "total vendido" — o que de fato
-- entrou. `valor_contrato` permanece para conferência e análise.

ALTER TABLE public.projeto_vendido
	ADD COLUMN IF NOT EXISTS valor_vendido_real double precision;

COMMENT ON COLUMN public.projeto_vendido.valor_vendido_real IS
	'Referência para "total vendido": o que de fato entrou. Contrato assinado sem valor na planilha entra como 0 (decisão do dono do processo).';

COMMENT ON COLUMN public.projeto_vendido.valor_contrato IS
	'Valor contratado. Diverge de valor_vendido_real; mantido para conferência, não é a base das métricas de venda.';

-- ─────────────────────────────────────────────────────────────────
-- 3. Tirar o default silencioso de gestão
-- ─────────────────────────────────────────────────────────────────
-- Uma linha inserida sem gestão explícita entrava como 24/25 sem ninguém
-- perceber. Com três gestões na base, isso deixa de ser um detalhe.

ALTER TABLE public.projeto_vendido ALTER COLUMN gestao DROP DEFAULT;

ALTER TABLE public.projeto_vendido
	ADD CONSTRAINT projeto_gestao_formato
	CHECK (gestao ~ '^\d{2}/\d{2}$');

-- ─────────────────────────────────────────────────────────────────
-- 4. Índices
-- ─────────────────────────────────────────────────────────────────
-- Quando a leitura migrar do Sheets para o banco (F3), as consultas vão filtrar
-- por gestão. `uq_projeto_gestao` começa por nome_projeto, então não atende.

CREATE INDEX IF NOT EXISTS idx_projeto_gestao
	ON public.projeto_vendido USING btree (gestao);

-- `card_pipefy_id_key`, criado pelo UNIQUE, já atende qualquer busca por
-- pipefy_id. O índice abaixo era duplicata pura, custando escrita a cada sync.
DROP INDEX IF EXISTS public.idx_card_pipefy_id;

-- ─────────────────────────────────────────────────────────────────
-- Fora do escopo desta migration (ficam nas fases que as motivam)
-- ─────────────────────────────────────────────────────────────────
--   · timestamp without time zone → timestamptz em card e funil        (F6)
--   · remover DEFAULT now() de funil.timestamp, que inventa histórico  (F6)
--   · card.pipe_id                                                     (F6)
--   · ingestao_execucao / ingestao_rejeicao / colunas de linhagem      (F5)
--   · cobertura_fonte                                                  (F6)
--   · snapshot_periodo                                                 (F7)

COMMIT;
