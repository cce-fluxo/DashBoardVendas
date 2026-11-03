-- 0018_sincronizacao_de_5_em_5.sql
--
-- A TV da sede mostra uma faixa quando chega lead novo no Pipefy. Com o Pipefy
-- de 30 em 30 min, o lead só aparecia até meia hora depois. Agora Pipefy e
-- planilhas rodam juntos, a cada 5 min, nos MESMOS minutos.
--
-- O Pipefy continua 24 h: o limite de frescor dele (3 h, auditoria/frescor.ts)
-- e o do agendador (disparo_recente) acusariam a madrugada inteira se ele
-- parasse à noite. As planilhas seguem só das 07h às 21h em Brasília.
--
-- Sobreposição não acontece: a rodada incremental fecha em ~9 s e a rota tem
-- maxDuration de 300 s, igual ao intervalo.
--
-- Minutos 4, 9, …, 59: fora do topo da hora, como na 0007.
-- `cron.schedule` é idempotente por NOME: substitui a 0007 e a 0017.

SELECT cron.schedule(
	'sync-pipefy',
	'4-59/5 * * * *',
	$$SELECT public.disparar_sync('pipefy')$$
);

SELECT cron.schedule(
	'sync-sheets',
	-- 10–23 UTC = 07–20h em Brasília.
	'4-59/5 10-23 * * *',
	$$SELECT public.disparar_sync('sheets')$$
);

-- Conferência:
--     select jobname, schedule, active from cron.job;
