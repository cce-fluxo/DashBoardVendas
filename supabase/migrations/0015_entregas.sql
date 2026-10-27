-- 0015_entregas.sql
--
-- Projetos entregues e em execução, para a tela "Últimas entregas" da TV (/tv).
--
-- Fonte: a planilha de projetos (registry, FONTE_ENTREGAS), abas "Projetos -
-- Entregues" e "Projetos - Atual". Uma aba cobre todas as gestões: a gestão de
-- cada projeto vem das colunas "Gestão - Venda" e "Gestão - Entrega".
--
-- O banco guarda o que a planilha diz, inclusive "Rescindido" em `situacao`
-- (a coluna "Prev. Prazo"): quem decide que rescindido não é entrega é a leitura.
-- `data_entrega` também é a da planilha, sem conferência — há datas com o ano
-- errado, e a tela descarta as que caem fora da gestão da entrega.

BEGIN;

CREATE TABLE IF NOT EXISTS public.projeto_entrega (
	id_projeto_entrega serial PRIMARY KEY,
	estado          text NOT NULL CHECK (estado = ANY (ARRAY['entregue','em_execucao']::text[])),
	coordenacao     text NOT NULL CHECK (coordenacao = ANY (ARRAY['CCE','ACE','MNP','QAB','PRO']::text[])),
	nome_projeto    text NOT NULL,
	-- NULL = vazio ou "-" na planilha.
	gestao_venda    text CHECK (gestao_venda ~ '^\d{2}/\d{2}$'),
	gestao_entrega  text CHECK (gestao_entrega ~ '^\d{2}/\d{2}$'),
	data_entrega    date,
	tamanho_equipe  integer,
	situacao        text,
	origem_tipo     text,
	origem_ref      text,
	id_execucao     integer REFERENCES public.ingestao_execucao(id_execucao) ON DELETE SET NULL
);

-- O mesmo nome de projeto se repete entre gestões ("Legalização ..." vendida
-- em 21/22 e de novo em 25/26): a gestão da venda entra na chave.
CREATE UNIQUE INDEX IF NOT EXISTS projeto_entrega_unique_idx
	ON public.projeto_entrega USING btree (estado, coordenacao, nome_projeto, gestao_venda)
	NULLS NOT DISTINCT;

ALTER TABLE public.projeto_entrega ENABLE ROW LEVEL SECURITY;

COMMIT;
