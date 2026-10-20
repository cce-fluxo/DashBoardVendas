-- 0007_agendamento_no_banco.sql
--
-- Move o agendamento da sincronização para dentro do Postgres.
--
-- POR QUE SAIR DO GITHUB ACTIONS
--
-- A documentação do GitHub é explícita sobre o evento `schedule`: ele "pode ser
-- atrasado em períodos de alta carga", os horários de pico "incluem o início de
-- cada hora", e "alguns jobs enfileirados podem ser DESCARTADOS".
--
-- Medido neste projeto em agosto/2026, com `*/30 * * * *`:
--
--     mediana entre execuções    58 min   (esperado: 30)
--     p90                       109 min
--     máximo                    628 min   = 10,5 horas
--     dentro de 30±15 min       5 de 59
--     ocorreram 60 execuções onde caberiam 166 — 64% nunca aconteceram
--
-- Mudar o minuto para fora do topo da hora (feito no cron.yml) reduz a chance de
-- atraso, mas é mitigação, não garantia.
--
-- Há um segundo motivo, de custo: o repositório é privado, e o plano Free do
-- GitHub inclui 2.000 minutos de Actions por mês. Rodando de verdade a cada 30
-- minutos são 1.440 execuções mensais — se cada job for cobrado com
-- arredondamento de 1 minuto, isso consome a maior parte da cota para um
-- trabalho que leva 9 segundos.
--
-- POR QUE AQUI
--
-- pg_cron roda dentro do banco que já é a fonte da verdade: sem serviço de
-- terceiro novo, sem minuto de CI, sem segredo saindo da infraestrutura que
-- você já controla. E precisão de minuto de verdade.
--
-- O QUE ISTO **NÃO** RESOLVE
--
-- `pg_net` é assíncrono e não espera resposta: se o endpoint devolver erro, o
-- job aqui continua "bem-sucedido". Isso é aceitável porque a falha aparece em
-- outro lugar — `ingestao_execucao` registra cada carga, a auditoria acusa fonte
-- sem carga recente, e o dashboard passou a mostrar a idade real do dado. O
-- agendador não precisa saber que falhou; a TELA precisa.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Segredos ─────────────────────────────────────────────────────
--
-- A URL e o CRON_SECRET ficam no Vault do Supabase, NÃO neste arquivo: uma
-- migration é versionada em Git, e segredo em Git é segredo vazado.
--
-- `app_base_url` é SÓ O DOMÍNIO. Sem caminho, sem barra no fim — o
-- "/api/cron/<alvo>" é acrescentado pela função. Guardar a URL completa produz
-- "/api/cron/pipefy/api/cron/pipefy" e um 404 que parece problema de outra
-- coisa. (Aconteceu: o placeholder abaixo foi colado com o caminho junto, e
-- como qualquer subdomínio inexistente em *.vercel.app devolve a página de
-- NOT_FOUND do Vercel, o sintoma foi idêntico ao de rota ausente.)
--
-- Antes de agendar, grave os dois (uma vez, direto no SQL editor), TROCANDO os
-- valores entre <>:
--
--   select vault.create_secret('https://<dominio-de-producao>.vercel.app', 'app_base_url');
--   select vault.create_secret('<o mesmo valor de CRON_SECRET no Vercel>',  'cron_secret');
--
-- Precisa ser o domínio de PRODUÇÃO — não o de um deploy específico
-- (projeto-a1b2c3-time.vercel.app) nem o de preview, que apontam para builds
-- de branch.
--
-- Para trocar depois, sem precisar copiar o id:
--
--   select vault.update_secret(id, 'https://<dominio-correto>')
--     from vault.secrets where name = 'app_base_url';
--
-- Para conferir o que está guardado:
--
--   select name, decrypted_secret from vault.decrypted_secrets;

CREATE OR REPLACE FUNCTION public.disparar_sync(alvo text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
	base    text;
	segredo text;
	req_id  bigint;
BEGIN
	IF alvo NOT IN ('pipefy', 'sheets') THEN
		RAISE EXCEPTION 'alvo inválido: %. Use ''pipefy'' ou ''sheets''.', alvo;
	END IF;

	SELECT decrypted_secret INTO base
		FROM vault.decrypted_secrets WHERE name = 'app_base_url';
	SELECT decrypted_secret INTO segredo
		FROM vault.decrypted_secrets WHERE name = 'cron_secret';

	-- Falhar alto é melhor que disparar para lugar nenhum: sem os segredos, o
	-- job "rodaria" para sempre sem sincronizar nada, e a única pista seria o
	-- dado envelhecendo sem explicação.
	IF base IS NULL OR segredo IS NULL THEN
		RAISE EXCEPTION
			'Segredos ausentes no Vault (app_base_url / cron_secret). '
			'Ver o cabeçalho da migration 0007.';
	END IF;

	SELECT net.http_post(
		url     := base || '/api/cron/' || alvo,
		body    := '{}'::jsonb,
		headers := jsonb_build_object(
			'Content-Type',  'application/json',
			'Authorization', 'Bearer ' || segredo
		),
		timeout_milliseconds := 120000
	) INTO req_id;

	RETURN req_id;
END;
$$;

COMMENT ON FUNCTION public.disparar_sync IS
	'Chama /api/cron/<alvo> com o CRON_SECRET do Vault. Assíncrono: não sabe se deu certo — quem acusa é ingestao_execucao e a idade do dado na tela.';

-- Só o dono do banco dispara. Sem isto, qualquer papel com acesso ao schema
-- public poderia inundar o endpoint de sincronização.
REVOKE ALL ON FUNCTION public.disparar_sync(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disparar_sync(text) FROM anon, authenticated;

-- ── Agendamento ──────────────────────────────────────────────────
--
-- Minutos 7 e 37 pelo mesmo motivo do cron.yml: nada obriga o topo da hora, e
-- fugir dele é hábito bom mesmo onde não há fila compartilhada.
--
-- `cron.schedule` é idempotente por NOME: reaplicar a migration substitui o
-- agendamento em vez de duplicá-lo.

SELECT cron.schedule(
	'sync-pipefy',
	'7,37 * * * *',
	$$SELECT public.disparar_sync('pipefy')$$
);

-- Planilhas uma vez por dia. 09:23 UTC = 06:23 em Brasília.
SELECT cron.schedule(
	'sync-sheets',
	'23 9 * * *',
	$$SELECT public.disparar_sync('sheets')$$
);

COMMIT;

-- ── Conferência ──────────────────────────────────────────────────
--
-- Agendamentos ativos:
--     select jobid, jobname, schedule, active from cron.job;
--
-- Últimas execuções do agendador (sucesso aqui = "a chamada saiu", não "a
-- sincronização funcionou" — para isso, olhe ingestao_execucao):
--     select jobid, status, start_time, return_message
--       from cron.job_run_details order by start_time desc limit 20;
--
-- Respostas HTTP recebidas:
--     select id, status_code, created from net._http_response
--      order by created desc limit 20;
--
-- Disparar à mão, para testar antes de esperar o horário:
--     select public.disparar_sync('pipefy');
--
-- Para desligar sem apagar:
--     select cron.unschedule('sync-pipefy');
