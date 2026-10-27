-- 0017_planilhas_de_15_em_15.sql
--
-- A TV da sede (/tv) mostra o último contrato fechado e as últimas entregas.
-- Com as planilhas lidas uma vez por dia (06:23), um contrato assinado de manhã
-- só aparecia no dia seguinte. Agora: a cada 15 min, das 07h às 21h em
-- Brasília. De madrugada ninguém mexe na planilha e ninguém olha a TV.
--
-- Custo: uma rodada fecha em ~6 s e faz poucas leituras na API do Sheets,
-- longe da cota por minuto.
--
-- `cron.schedule` é idempotente por NOME: substitui o agendamento da 0007.

SELECT cron.schedule(
	'sync-sheets',
	-- Minutos fora do topo da hora, como na 0007. 10–23 UTC = 07–20h em Brasília.
	'4,19,34,49 10-23 * * *',
	$$SELECT public.disparar_sync('sheets')$$
);

-- Conferência:
--     select jobname, schedule, active from cron.job;
