-- 0016_equipe_da_entrega.sql
--
-- Quem fez cada projeto (colunas "Gerente" e "Consultor 1..6" da planilha de
-- projetos), para a tela de entregas da TV mostrar os rostos. Nomes como a
-- planilha escreve: a ligação com `pessoa` é feita na leitura, como nos
-- contratos (src/lib/pessoas.ts).

ALTER TABLE public.projeto_entrega
	ADD COLUMN IF NOT EXISTS equipe text[] NOT NULL DEFAULT '{}';
