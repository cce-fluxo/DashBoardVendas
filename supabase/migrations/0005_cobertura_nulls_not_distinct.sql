-- 0005_cobertura_nulls_not_distinct.sql
--
-- Conserta a UNIQUE de cobertura_fonte criada na 0004.
--
-- O PROBLEMA
--
-- A 0004 declarou `UNIQUE (fonte_tipo, fonte_ref, gestao)`. Em Postgres, o
-- padrão é NULLS DISTINCT: dois NULL nunca são considerados iguais, então a
-- restrição NÃO impede duas linhas idênticas quando `gestao` é NULL.
--
-- E `gestao` é NULL justamente nas linhas dos pipes — a cobertura do Pipefy
-- atravessa gestões, é isso que o NULL quer dizer ali.
--
-- Consequência: `upsert(..., { onConflict: "fonte_tipo,fonte_ref,gestao" })`
-- nunca casaria para os pipes. Cada carga inseriria duas linhas novas em vez de
-- atualizar as existentes, e a tabela que existe para dizer "isto foi medido"
-- passaria a acumular versões contraditórias da própria resposta.
--
-- Nada disso chegou a acontecer: a 0004 subiu e a primeira escrita ainda não
-- rodou. Mas é o MESMO defeito que fez o cron de metas falhar em toda linha por
-- meses (índice com 4 colunas, onConflict com 3, erro 42P10 engolido num
-- contador). Vale registrar o padrão: chave parcialmente NULL + upsert é uma
-- combinação que falha em silêncio.

BEGIN;

ALTER TABLE public.cobertura_fonte
	DROP CONSTRAINT IF EXISTS cobertura_fonte_fonte_tipo_fonte_ref_gestao_key;

-- Limpa eventuais duplicatas antes de recriar a restrição mais estrita.
-- Mantém a linha de maior id (a mais recente).
DELETE FROM public.cobertura_fonte a
	USING public.cobertura_fonte b
	WHERE a.id_cobertura < b.id_cobertura
	  AND a.fonte_tipo = b.fonte_tipo
	  AND a.fonte_ref  = b.fonte_ref
	  AND a.gestao IS NOT DISTINCT FROM b.gestao;

ALTER TABLE public.cobertura_fonte
	ADD CONSTRAINT cobertura_fonte_chave
	UNIQUE NULLS NOT DISTINCT (fonte_tipo, fonte_ref, gestao);

COMMENT ON CONSTRAINT cobertura_fonte_chave ON public.cobertura_fonte IS
	'NULLS NOT DISTINCT é obrigatório: gestao é NULL nas coberturas de pipe, e sem isso o upsert duplicaria a cada carga.';

COMMIT;
