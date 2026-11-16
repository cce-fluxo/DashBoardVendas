-- 0020_prospeccao_ativa.sql
--
-- Competição de outbound na TV (/tv): Time Cellbit × Time Manu, pontuados pelo
-- pipe "[CRM] Prospecção Ativa" (307434892) e, depois do diagnóstico, pelo card
-- correlato no CRM COM. Regra em src/lib/outbound.ts.
--
-- POR QUE TABELA PRÓPRIA E NÃO `card`
--
-- `card` é lido por funil, faixa de lead novo e "alocados" da TV. Os ~800 cards
-- de base da prospecção entrariam em todos eles. As fases também não são as 8
-- etapas canônicas.
--
-- E-MAIL E TELEFONE SÓ COMO HASH
--
-- Os dois pipes não têm conexão nativa e o título do CRM COM é "Rascunho", então
-- a ligação é por e-mail, telefone ou empresa. Como na 0019, contato de pessoa
-- de fora não fica no banco: guardamos o SHA-256 do valor normalizado
-- (src/lib/outbound.ts, `chaveEmail`/`chaveTelefone`). Casa igual, não se lê.

BEGIN;

ALTER TABLE public.card
	ADD COLUMN IF NOT EXISTS empresa        text,
	ADD COLUMN IF NOT EXISTS email_hash     text,
	ADD COLUMN IF NOT EXISTS telefone_hash  text;

CREATE TABLE IF NOT EXISTS public.prospeccao_card (
	id_prospeccao     serial PRIMARY KEY,
	pipefy_id         text NOT NULL UNIQUE,
	nome_card         text NOT NULL,
	empresa           text,
	email_hash        text,
	telefone_hash     text,
	-- "SDR responsável" como o Pipefy escreve; a pessoa é resolvida na leitura.
	sdr               text,
	etapa_atual       text NOT NULL,
	data_criacao      timestamptz,
	data_last_update  timestamptz,
	-- [{ "fase": "...", "em": "ISO" }]. Leitura é sempre a tabela inteira.
	fases             jsonb NOT NULL DEFAULT '[]'::jsonb
);

ALTER TABLE public.prospeccao_card ENABLE ROW LEVEL SECURITY;

-- Os 10 SDRs na base de pessoas, para nome curto e foto. Bernardo (156), João
-- Marcelo (215) e Nicoly (263, "Nicoly Maia Santos") já existiam: só ganham a
-- grafia do Pipefy. Grafia já normalizada (normalizarNomeVendedor).
INSERT INTO public.pessoa (nome_exibicao) VALUES
	('Miguel Antonio'), ('Peterson Carvalho'), ('Mirella Reis'), ('Mariana Peixoto'),
	('Felipe Onoda'), ('Mariana Rocha'), ('Anna Julia')
ON CONFLICT (nome_exibicao) DO NOTHING;

INSERT INTO public.pessoa_grafia (id_pessoa, grafia, gestao)
SELECT p.id_pessoa, g.grafia, NULL
FROM (VALUES
	('Bernardo Mourelle', 'Bernardo Borelli Mourelle'),
	('Miguel Antonio',    'Miguel Antonio Guimarães De Abreu Lima'),
	('Peterson Carvalho', 'Peterson Marques De Carvalho'),
	('Mirella Reis',      'Mirella Da Silva Reis'),
	('Mariana Peixoto',   'Mariana Peixoto'),
	('Felipe Onoda',      'Felipe Onoda Pessanha Bianchi'),
	('João Marcelo',      'Joaomarcelogamanobregacpereira'),
	('Nicoly Santos',     'Nicoly-maia-20242'),
	('Mariana Rocha',     'Mariana Ferreira'),
	('Anna Julia',        'Anna Julia Vieira')
) AS g (nome, grafia)
JOIN public.pessoa p ON p.nome_exibicao = g.nome
ON CONFLICT ON CONSTRAINT pessoa_grafia_chave DO NOTHING;

COMMIT;
