// src/lib/metas-periodo.ts
//
// Qual meta vale para um período.
//
// Esta lógica morava DENTRO do handler de /api/dashboard, como duas funções
// aninhadas. Enquanto só a tela lia metas, tudo bem. O congelamento de períodos
// (F7) precisa exatamente do mesmo cálculo — e uma segunda cópia significaria
// que um dia o número congelado e o número da tela discordariam por uma
// diferença de regra que ninguém lembraria de ter escrito duas vezes.
//
// É o mesmo motivo de fontes/pipes.ts existir: definição única.

import { Coordenacao, MetaPeriodo, PeriodoGestao } from "@/types";

// A lista vive em coordenacoes.ts. Reexportada aqui porque metas, snapshots e a
// legenda de exportação já a importavam deste caminho — mover o valor sem mover
// o nome evitaria a sexta cópia e quebraria três arquivos por nada.
import { COORDENACOES } from "@/lib/coordenacoes";
export { COORDENACOES };

export interface SelecaoPeriodo {
	gestao: PeriodoGestao;
	tipo: "gestao" | "ciclo" | "mes";
	ciclo?: string | null;
	mes?: string | null;
}

/**
 * Meta geral (sem coordenação) do período, ou `null` se não houver.
 *
 * SEM FALLBACK. Havia um: faltando a meta do mês ou do ciclo, usava a da GESTÃO,
 * e agosto aparecia com 4,4% de atingimento porque comparava um mês contra o
 * alvo do ano. Período sem meta devolve null e a tela diz "sem meta definida" —
 * "não há meta" e "meta zero" são coisas diferentes.
 */
export function metaDoPeriodo(
	metas: MetaPeriodo[],
	sel: SelecaoPeriodo,
): MetaPeriodo | null {
	const gerais = metas.filter((m) => !m.coordenacao);

	if (sel.tipo === "mes" && sel.mes) {
		const mes = sel.mes.padStart(2, "0");
		return gerais.find((m) => m.mes === mes && m.gestao === sel.gestao) ?? null;
	}

	if (sel.tipo === "ciclo" && sel.ciclo) {
		// Igualdade exata: `ciclo` guarda o id ("waterloo"). O startsWith de antes
		// existia porque o rótulo era "Q1", que nunca foi como a Fluxo nomeia ciclo.
		return (
			gerais.find((m) => m.ciclo === sel.ciclo && m.gestao === sel.gestao) ?? null
		);
	}

	return gerais.find((m) => m.gestao === sel.gestao && !m.ciclo && !m.mes) ?? null;
}

/**
 * Meta de cada coordenação no período.
 *
 * Prioridade: meta do ciclo (quando o filtro é de ciclo) → meta da gestão.
 * Não existe meta mensal por coordenação na planilha, então mês cai na da gestão.
 * Coordenação sem meta devolve 0 — aqui zero é o valor certo, porque a soma por
 * coordenação alimenta comparação, não atingimento.
 */
export function metasPorCoordenacao(
	metas: MetaPeriodo[],
	sel: SelecaoPeriodo,
): Record<Coordenacao, number> {
	return Object.fromEntries(
		COORDENACOES.map((coord) => {
			let meta: MetaPeriodo | undefined;

			if (sel.tipo === "ciclo" && sel.ciclo) {
				meta = metas.find(
					(m) =>
						m.gestao === sel.gestao &&
						m.ciclo === sel.ciclo &&
						m.coordenacao === coord,
				);
			}

			if (!meta) {
				meta = metas.find(
					(m) =>
						m.gestao === sel.gestao &&
						!m.ciclo &&
						!m.mes &&
						m.coordenacao === coord,
				);
			}

			return [coord, meta?.metaVendas ?? 0];
		}),
	) as Record<Coordenacao, number>;
}
