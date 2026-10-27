-- 0011_base_de_pessoas.sql
--
-- Uma pessoa, várias grafias. Revoga a decisão do baseline ("não haverá
-- reconciliação").
--
-- O QUE ACONTECEU
--
-- `vendedor` é uma linha por GRAFIA normalizada. Em 23/24 e 24/25 os
-- responsáveis são apelidos ("Jonas", "Rafa"); em 25/26 e 26/27, nomes completos
-- ("Jonas Pimenta Thé"). A mesma pessoa vira duas ou três linhas, e um ranking
-- que atravessa gestões (o do painel de TV) fica fragmentado.
--
-- POR QUE RESOLVER NA LEITURA
--
-- `vendedor`, `projeto_vendedor` e `card_vendedor` continuam guardando o que a
-- fonte disse. A pessoa é resolvida quando as vendas são lidas
-- (src/lib/pessoas.ts). Corrigir esta base vale na hora, sem sync nem backfill —
-- as planilhas passadas não mudam, então a curadoria precisa morar aqui.
--
-- `gestao` NULL na grafia = vale em qualquer gestão (nome completo, Pipefy).
-- Preenchida = vale só nela: dois "Rafa" diferentes em 23/24 e 24/25 viram duas
-- linhas, cada uma com a sua gestão. A resolução tenta (grafia, gestão) antes de
-- (grafia, NULL).
--
-- NULLS NOT DISTINCT pelo mesmo motivo da 0005: sem ele, duas grafias idênticas
-- com gestão NULL passariam pela restrição.
--
-- A grafia é gravada já normalizada (`normalizarNomeVendedor`), para casar com
-- `vendedor.nome_vendedor`. Editar à mão no Table Editor exige a mesma forma:
-- palavras capitalizadas, um espaço entre elas.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pessoa (
	id_pessoa      serial PRIMARY KEY,
	-- UNIQUE porque o ranking agrupa pelo nome exibido: duas pessoas com o
	-- mesmo nome curto virariam uma só, somadas, sem erro nenhum.
	nome_exibicao  text NOT NULL UNIQUE CHECK (btrim(nome_exibicao) <> ''),
	criado_em      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.pessoa.nome_exibicao IS
	'Nome curto para tela (ex.: "Agatha Frossard"). As iniciais são derivadas dele.';

CREATE TABLE IF NOT EXISTS public.pessoa_grafia (
	id_grafia  serial PRIMARY KEY,
	id_pessoa  integer NOT NULL REFERENCES public.pessoa(id_pessoa) ON DELETE CASCADE,
	grafia     text NOT NULL CHECK (btrim(grafia) <> ''),
	gestao     text,
	CONSTRAINT pessoa_grafia_chave UNIQUE NULLS NOT DISTINCT (grafia, gestao)
);

CREATE INDEX IF NOT EXISTS idx_pessoa_grafia_pessoa
	ON public.pessoa_grafia USING btree (id_pessoa);

-- Mesmo regime das outras tabelas: RLS ligado, o servidor usa a service_role.
ALTER TABLE public.pessoa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pessoa_grafia ENABLE ROW LEVEL SECURITY;

COMMIT;
