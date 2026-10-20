-- 0009_url_verificavel.sql
--
-- Deixa a URL do disparo conferível sem precisar disparar.
--
-- O QUE ACONTECEU
--
-- Os disparos agendados devolviam 404 do Vercel. Não era secret errado (daria
-- 401), nem DNS, nem redirecionamento — a requisição chegava ao servidor certo
-- e o caminho não existia. O `app_base_url` guardado no Vault não era a mesma
-- URL que o GitHub Actions usava com sucesso.
--
-- Descobrir isso exigiu aplicar duas migrations e ler respostas HTTP. A causa
-- era um texto errado numa linha, e não havia como olhá-lo: a função montava a
-- URL por dentro e só devolvia um id de requisição.
--
-- Ferramenta que só funciona não ajuda a consertar. Esta migration acrescenta a
-- pergunta que faltava — "para onde exatamente você vai chamar?" — respondida
-- sem efeito nenhum.
--
-- E fecha um risco que estava aberto: `SELECT ... INTO` num SELECT que devolve
-- várias linhas pega UMA arbitrariamente, sem erro. Rodar `vault.create_secret`
-- duas vezes com valores diferentes deixaria a escolha ao acaso, e o sintoma
-- seria intermitente — o pior tipo para depurar.

BEGIN;

CREATE OR REPLACE FUNCTION public.segredo_do_vault(nome text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
	quantos int;
	valor   text;
BEGIN
	SELECT count(*) INTO quantos
		FROM vault.decrypted_secrets WHERE name = nome;

	IF quantos = 0 THEN
		RAISE EXCEPTION
			'Segredo "%" não existe no Vault. Crie com: select vault.create_secret(''valor'', ''%'');',
			nome, nome;
	END IF;

	-- Duplicata é ambiguidade, não detalhe: com dois valores para o mesmo nome,
	-- qualquer escolha automática produz comportamento que muda sozinho.
	IF quantos > 1 THEN
		RAISE EXCEPTION
			'Segredo "%" está no Vault % vezes. Apague os extras — com duplicatas, qual valor vale passa a ser sorteio.',
			nome, quantos;
	END IF;

	SELECT btrim(decrypted_secret) INTO valor
		FROM vault.decrypted_secrets WHERE name = nome;

	RETURN valor;
END;
$$;

REVOKE ALL ON FUNCTION public.segredo_do_vault(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.segredo_do_vault(text) FROM anon, authenticated;

-- ── A URL, sem disparar ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.url_do_disparo(alvo text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
	base text;
BEGIN
	IF alvo NOT IN ('pipefy', 'sheets') THEN
		RAISE EXCEPTION 'alvo inválido: %. Use ''pipefy'' ou ''sheets''.', alvo;
	END IF;

	base := regexp_replace(public.segredo_do_vault('app_base_url'), '/+$', '');
	RETURN base || '/api/cron/' || alvo;
END;
$$;

COMMENT ON FUNCTION public.url_do_disparo IS
	'Para onde o disparo agendado vai chamar. Não chama — serve para conferir a URL sem produzir efeito.';

REVOKE ALL ON FUNCTION public.url_do_disparo(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.url_do_disparo(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.url_do_disparo(text) TO service_role;

-- ── disparar_sync passa a usar o leitor com guardas ──────────────

CREATE OR REPLACE FUNCTION public.disparar_sync(alvo text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
	url     text;
	segredo text;
	req_id  bigint;
BEGIN
	-- Valida o alvo, lê o Vault com as guardas e monta a URL: tudo em um lugar
	-- só, e o mesmo que `url_do_disparo` mostra. Se divergissem, a conferência
	-- passaria a confirmar uma coisa enquanto o disparo faz outra.
	url := public.url_do_disparo(alvo);
	segredo := public.segredo_do_vault('cron_secret');

	IF url !~ '^https?://' THEN
		RAISE EXCEPTION
			'app_base_url precisa começar com http:// ou https:// (montou "%").',
			left(url, 30);
	END IF;

	SELECT net.http_post(
		url     := url,
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

COMMIT;

-- ── Conferência ──────────────────────────────────────────────────
--
-- Ver para onde vai chamar (sem chamar):
--     select public.url_do_disparo('pipefy');
--
-- Compare com a URL de produção do projeto no Vercel. Precisa ser o domínio de
-- PRODUÇÃO, não o de um deploy específico nem o de preview.
--
-- Corrigir (o primeiro argumento é o UUID do segredo, não o valor atual —
-- passar o valor devolve "invalid input syntax for type uuid"):
--     select vault.update_secret(id, 'https://<dominio-de-producao>')
--       from vault.secrets where name = 'app_base_url';
--
-- Depois:
--     select public.disparar_sync('pipefy');
--     select id, status_code, corpo from public.disparo_recente limit 3;
