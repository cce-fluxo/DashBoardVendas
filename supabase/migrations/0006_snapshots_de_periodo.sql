-- 0006_snapshots_de_periodo.sql
--
-- Congela as métricas de um período fechado.
--
-- O PROBLEMA QUE ISTO RESOLVE
--
-- Hoje todo número da tela é recalculado da planilha a cada leitura. Corrigir
-- uma linha de 24/25 na planilha em 2027 muda, retroativamente e em silêncio, um
-- número que já foi apresentado em reunião. Não existe "o que a gestão 24/25
-- fechou" — existe só "o que a planilha diz hoje sobre 24/25".
--
-- Para um dash que quer ser fonte da verdade isso é fatal: a fonte da verdade
-- precisa ter memória, não só estado atual.
--
-- APPEND-ONLY, e garantido pelo banco. Um snapshot que pode ser editado não
-- congela nada — só dá a impressão de congelar. O gatilho abaixo recusa UPDATE.
-- A convenção no código não bastaria: quem apaga o número já reportado
-- raramente é quem leu o comentário.

BEGIN;

CREATE TABLE public.snapshot_periodo (
	id_snapshot  serial PRIMARY KEY,

	gestao       text NOT NULL,
	-- 'gestao' | 'ciclo' | 'mes'
	tipo_periodo text NOT NULL
		CHECK (tipo_periodo = ANY (ARRAY['gestao','ciclo','mes'])),
	-- id do ciclo ("waterloo"), mês ("03") ou a própria gestão ("24/25").
	periodo      text NOT NULL,

	-- 'geral' hoje. A coluna existe para o dia em que se quiser congelar por
	-- coordenação em linhas separadas; por ora o recorte por coordenação vive
	-- DENTRO de `metricas`, para que um hash só cubra o período inteiro.
	escopo       text NOT NULL DEFAULT 'geral',

	metricas     jsonb NOT NULL,

	-- sha256 do JSON canônico de `metricas`. Detecta alteração feita por fora
	-- (acesso direto ao banco, restore de dump, migração mal feita).
	hash_metricas text NOT NULL,

	-- Versão do CÓDIGO que calculou. Permite recalcular hoje e comparar com o
	-- congelado: divergência com a mesma versão é bug ou fonte alterada;
	-- divergência entre versões é mudança de regra, e aí a pergunta é outra.
	versao_calculo integer NOT NULL,

	gerado_em    timestamptz NOT NULL DEFAULT now(),
	-- De qual carga saiu o dado congelado.
	id_execucao  integer REFERENCES public.ingestao_execucao(id_execucao)
		ON DELETE SET NULL,

	-- Um snapshot por período por versão de cálculo. Sem NULL na chave, então o
	-- padrão NULLS DISTINCT não morde aqui (ver a 0005 para o caso em que mordeu).
	UNIQUE (gestao, tipo_periodo, periodo, escopo, versao_calculo)
);

COMMENT ON TABLE public.snapshot_periodo IS
	'Métricas congeladas de período fechado. Append-only: UPDATE é recusado por gatilho.';

CREATE INDEX idx_snapshot_periodo_busca
	ON public.snapshot_periodo USING btree (gestao, tipo_periodo, periodo);

-- ── Imutabilidade ────────────────────────────────────────────────
--
-- Recusa UPDATE. DELETE continua possível de propósito: um snapshot gerado por
-- engano (versão de cálculo errada, período que ainda não devia fechar) precisa
-- ter conserto, e não haveria como corrigi-lo sem apagar. O que não pode é
-- ALTERAR um número mantendo a aparência de original.

CREATE OR REPLACE FUNCTION public.snapshot_periodo_imutavel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION
		'snapshot_periodo é append-only: UPDATE recusado no snapshot #% (% % %). '
		'Para corrigir um congelamento errado, APAGUE a linha e gere de novo — '
		'assim fica claro que houve refazimento, em vez de um número trocado por baixo.',
		OLD.id_snapshot, OLD.gestao, OLD.tipo_periodo, OLD.periodo;
END;
$$;

CREATE TRIGGER trg_snapshot_periodo_imutavel
	BEFORE UPDATE ON public.snapshot_periodo
	FOR EACH ROW EXECUTE FUNCTION public.snapshot_periodo_imutavel();

COMMIT;
