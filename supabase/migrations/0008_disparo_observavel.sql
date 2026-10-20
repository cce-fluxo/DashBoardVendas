-- 0008_disparo_observavel.sql
--
-- Torna visível o resultado do disparo agendado.
--
-- O QUE DEU ERRADO
--
-- A 0007 disse que "pg_net é assíncrono e não sabe se falhou; quem acusa é
-- ingestao_execucao e a idade do dado na tela". Está certo para detectar QUE
-- falhou — e é inútil para descobrir POR QUE. Quando o disparo parou de chegar
-- ao endpoint, o sintoma foi ausência de execução: o mesmo sintoma de URL
-- errada, de secret divergente, de 404, de redirecionamento não seguido e de
-- worker do pg_net parado. Cinco causas, um sintoma, nenhuma pista.
--
-- A resposta HTTP existe em `net._http_response`, mas o schema `net` não é
-- exposto pelo PostgREST — então nem a auditoria nem quem estivesse depurando
-- conseguia lê-la sem abrir o SQL editor.
--
-- DUAS CORREÇÕES
--
-- 1. A URL passa por normalização. Barra no fim produz "//api/cron/pipefy", que
--    o Vercel responde com redirecionamento — e pg_net NÃO segue redirecionamento.
--    A requisição "funciona", devolve 3xx e nada sincroniza. Espaço em volta,
--    colado ao copiar, tem o mesmo efeito.
--
-- 2. Uma view em `public` expõe as respostas recentes, restrita ao service_role.
--    Fire-and-forget não precisa esperar a resposta — precisa poder consultá-la
--    depois.

BEGIN;

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

	IF base IS NULL OR segredo IS NULL THEN
		RAISE EXCEPTION
			'Segredos ausentes no Vault (app_base_url / cron_secret). '
			'Ver o cabeçalho da migration 0007.';
	END IF;

	-- Tira espaços e barras finais. Ver a nota 1 no cabeçalho: a falha por barra
	-- extra é silenciosa e indistinguível de secret errado.
	base := regexp_replace(btrim(base), '/+$', '');
	segredo := btrim(segredo);

	IF base !~ '^https?://' THEN
		RAISE EXCEPTION
			'app_base_url precisa começar com http:// ou https:// (valor atual começa com "%").',
			left(base, 12);
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

REVOKE ALL ON FUNCTION public.disparar_sync(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disparar_sync(text) FROM anon, authenticated;

-- ── Respostas visíveis ───────────────────────────────────────────
--
-- `security_invoker = off` (padrão) faz a view rodar com os privilégios do dono,
-- que é como ela alcança o schema `net`. O acesso é fechado logo abaixo: só o
-- service_role lê, porque o corpo da resposta pode conter mensagem de erro do
-- endpoint.

CREATE OR REPLACE VIEW public.disparo_recente AS
SELECT
	r.id,
	r.status_code,
	r.error_msg,
	r.created,
	-- O corpo carrega as contagens da sincronização; truncado porque aqui só
	-- interessa o suficiente para saber se deu certo.
	left(r.content, 400) AS corpo
FROM net._http_response r
ORDER BY r.created DESC
LIMIT 100;

COMMENT ON VIEW public.disparo_recente IS
	'Respostas HTTP dos disparos agendados. Existe porque "não sincronizou" tem cinco causas possíveis e nenhuma delas aparece em ingestao_execucao.';

REVOKE ALL ON public.disparo_recente FROM PUBLIC;
REVOKE ALL ON public.disparo_recente FROM anon, authenticated;
GRANT SELECT ON public.disparo_recente TO service_role;

COMMIT;

-- ── Conferência ──────────────────────────────────────────────────
--
-- Disparar e olhar o resultado:
--     select public.disparar_sync('pipefy');
--     -- espere uns 15s
--     select id, status_code, error_msg, corpo from public.disparo_recente limit 5;
--
--   status 200            → chegou e sincronizou
--   status 401            → cron_secret do Vault ≠ CRON_SECRET do Vercel
--   status 404            → app_base_url aponta para o lugar errado
--   status 3xx            → redirecionamento (pg_net não segue): confira a URL
--   error_msg preenchido  → nem saiu (DNS, timeout, worker do pg_net parado)
--
-- Se NADA aparecer na view, o worker do pg_net não está processando a fila:
--     select net.worker_restart();
--
-- Agendamentos e histórico do agendador:
--     select jobid, jobname, schedule, active from cron.job;
--     select jobid, status, start_time, return_message
--       from cron.job_run_details order by start_time desc limit 10;
