// src/lib/supabase-funil.ts
//
// Funções de query do Supabase para dados do funil.
// Toda a informação vem das tabelas `card` e `funil`, sincronizadas pelo cron.
//
// DESIGN IMPORTANTE — dois conceitos separados:
//
//   buscarCardsComHistorico()
//     Retorna TODOS os cards (sem filtro de data), incluindo data_criacao e o
//     histórico de fases. O recorte pelo período selecionado — que vale para
//     quantidade por fase, conversão e tempo — é feito em calculations-funil.ts.
//
// INGESTÃO vs LEITURA:
//   O banco armazena coordenacoes[] com valores crus do Pipefy (incluindo "N1", "OUTBOUND", etc).
//   Esta função NÃO filtra coordenacoes — passa o array inteiro para a camada de cálculo.
//   Apenas coordenacao (singular) é normalizado para null quando fora das 5 padrões,
//   pois é usado como atalho de compatibilidade com dados do Sheets (v.coordenacao).
//
// Não aplique filtro de data_criacao aqui — ele pertence à camada de cálculo.

import { createClient } from "@supabase/supabase-js";
import { EtapaFunil, Coordenacao } from "@/types";

function getSupabase() {
	return createClient(
		process.env.SUPABASE_URL!,
		process.env.SUPABASE_SERVICE_ROLE_KEY!,
	);
}

// ─── Tipos exportados ─────────────────────────────────────────────

// Etapa como armazenada: 8 fases comerciais + 2 terminais.
export type EtapaArmazenada = EtapaFunil | "Perdido" | "Pausado";

export interface TransicaoFunil {
	etapa: EtapaArmazenada;
	timestamp: string; // ISO string
}

export interface CardComHistorico {
	id_card: number;
	pipefy_id: string;
	/**
	 * Pipe de origem. Define quais etapas foram INSTRUMENTADAS para este card:
	 * o pipe antigo não tem "Contato aberto" nem "Precificação/Aprovação", e um
	 * card de lá jamais poderia ter passado por elas.
	 * null = card gravado antes da migration 0004.
	 */
	pipe_id: string | null;
	nome_card: string;
	etapa_atual: EtapaArmazenada;
	coordenacao: Coordenacao | null;
	valor_contrato: number | null;
	data_criacao: string | null; // ISO string — usado para filtrar gestão em calculations-funil.ts
	coordenacoes: string[]; // array cru do banco — pode conter "N1", "OUTBOUND", etc.
	historico: TransicaoFunil[]; // ordenado por timestamp asc
}

// ─── Query principal ──────────────────────────────────────────────

// Formato cru de uma linha do select abaixo, antes da normalização.
interface LinhaCard {
	id_card: number;
	pipefy_id: string;
	pipe_id: string | null;
	nome_card: string;
	etapa_atual: string;
	coordenacao: string | null;
	coordenacoes: string[] | null;
	valor_contrato: number | null;
	data_criacao: string | null;
	funil: { etapa: string; timestamp: string }[] | null;
}

// Supabase limita cada resposta a no máximo `max-rows` linhas (padrão do projeto:
// 1000). Sem paginação, bancos com mais de 1000 cards são TRUNCADOS de forma
// não-determinística — derrubando contagens por fase silenciosamente. Por isso
// paginamos com .range() até trazer todas as linhas.
const PAGINA_SUPABASE = 1000;

export async function buscarCardsComHistorico(): Promise<CardComHistorico[]> {
	const supabase = getSupabase();

	const linhas: LinhaCard[] = [];
	let inicio = 0;

	for (;;) {
		const { data, error } = await supabase
			.from("card")
			.select(
				`
      id_card,
      pipefy_id,
      pipe_id,
      nome_card,
      etapa_atual,
      coordenacao,
      coordenacoes,
      valor_contrato,
      data_criacao,
      funil ( etapa, timestamp )
    `,
			)
			// ORDENAR é parte da paginação, não enfeite. Sem ORDER BY, o Postgres
			// não deve ordem nenhuma entre duas consultas OFFSET/LIMIT separadas:
			// uma linha pode aparecer nas duas páginas e outra em nenhuma. Medido
			// neste banco em 11/08/2026 — 1236 linhas viravam 1234 únicas mais 2
			// repetidas, e o card que faltava era justamente o que a reconciliação
			// procurava. A chave primária serve porque é única e imutável.
			.order("id_card", { ascending: true })
			.range(inicio, inicio + PAGINA_SUPABASE - 1);

		if (error) {
			console.error(
				"[Supabase] Erro ao buscar cards com histórico:",
				error.message,
			);
			return [];
		}

		const lote = (data ?? []) as LinhaCard[];
		linhas.push(...lote);

		// Última página: veio menos que o tamanho cheio.
		if (lote.length < PAGINA_SUPABASE) break;
		inicio += PAGINA_SUPABASE;
	}

	const data = linhas;

	const COORDENACOES_VALIDAS: Coordenacao[] = [
		"CCE",
		"ACE",
		"MNP",
		"QAB",
		"PRO",
	];

	return (data ?? []).map((row) => {
		// coordenacao (singular): normalizado para null se não for uma das 5 padrões.
		// Mantido como atalho de compatibilidade — não usar como fonte de verdade
		// para breakdowns; use coordenacoes[].includes(coord) em vez disso.
		const coordenacao: Coordenacao | null = COORDENACOES_VALIDAS.includes(
			row.coordenacao as Coordenacao,
		)
			? (row.coordenacao as Coordenacao)
			: null;

		const historico: TransicaoFunil[] = (row.funil ?? [])
			.map((f) => ({
				etapa: f.etapa as EtapaArmazenada,
				timestamp: f.timestamp,
			}))
			.sort(
				(a: TransicaoFunil, b: TransicaoFunil) =>
					new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
			);

		// coordenacoes (plural): array cru do banco, SEM filtro.
		// ["PRO", "ACE"] fica ["PRO", "ACE"]. ["N1"] fica ["N1"].
		// filtrarPorCoordenacao() em calculations*.ts decide quem conta onde.
		const coordenacoes: string[] = row.coordenacoes ?? [];

		return {
			id_card: row.id_card,
			pipefy_id: row.pipefy_id,
			pipe_id: row.pipe_id ?? null,
			nome_card: row.nome_card,
			etapa_atual: row.etapa_atual as EtapaArmazenada,
			coordenacao,
			coordenacoes,
			valor_contrato: row.valor_contrato,
			data_criacao: row.data_criacao ?? null,
			historico,
		};
	});
}
