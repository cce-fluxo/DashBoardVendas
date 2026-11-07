-- 0019_indicacoes.sql
--
-- Respostas do formulário da campanha de indicações 26/27.1, para a tela
-- "Indicações" da TV (/tv): ranking de quem indicou e total.
--
-- Fonte: FONTE_INDICACOES no registry. Só entra o que a tela usa: quem indicou,
-- a coordenação e o carimbo. Nome, telefone e e-mail do CONTATO indicado ficam
-- na planilha, de propósito — a TV não precisa deles e o banco não deve guardá-los.

BEGIN;

CREATE TABLE IF NOT EXISTS public.indicacao (
	id_indicacao  serial PRIMARY KEY,
	-- "Carimbo de data/hora" como o Forms grava ("07/11/2026 14:32:10").
	carimbo       text NOT NULL,
	-- "Seu nome": texto livre; a ligação com `pessoa` é feita na leitura.
	indicador     text NOT NULL,
	-- Resposta crua da pergunta de coordenação.
	coordenacao   text,
	origem_tipo   text,
	origem_ref    text,
	id_execucao   integer REFERENCES public.ingestao_execucao(id_execucao) ON DELETE SET NULL
);

-- Duas respostas da mesma pessoa no mesmo segundo são a mesma resposta.
CREATE UNIQUE INDEX IF NOT EXISTS indicacao_unique_idx
	ON public.indicacao USING btree (carimbo, indicador);

ALTER TABLE public.indicacao ENABLE ROW LEVEL SECURITY;

COMMIT;
