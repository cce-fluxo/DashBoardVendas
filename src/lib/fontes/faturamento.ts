// src/lib/fontes/faturamento.ts
//
// Lê a grade de faturamento de uma aba da planilha "Fluxo Faturado por Mês".
//
// O layout, igual na "Visão Geral" e nas abas de coordenação, é um painel e não
// uma tabela: duas faixas de seis meses, cada uma com três linhas —
//
//     | Outubro/26 |           | Novembro/26 |           | ...
//     | Previsto   | Realizado | Previsto    | Realizado | ...
//     | R$ 166.340 | R$ 87.848 | R$ 72.425   | R$ 0,00   | ...
//
// O rótulo do mês fica na coluna do Previsto; o Realizado é a coluna seguinte.
// Puro (grade em memória): a rede fica em sheets-fonte.ts.

import { colunaParaLetra, mesDoRotulo, parsearValorMeta, type MetaIlegivel } from "./blocos";
import { normalizarCabecalho } from "./normalizar";
import type { Gestao } from "./tipos";

export interface FaturamentoLido {
	/** null = a Fluxo inteira. */
	coordenacao: string | null;
	/** "AAAA-MM-01". */
	mes: string;
	/** null = célula ilegível; o motivo está em `ilegiveis`. */
	previsto: number | null;
	realizado: number | null;
	origemRef: string;
}

export interface GradeFaturamentoLida {
	meses: FaturamentoLido[];
	ilegiveis: MetaIlegivel[];
	avisos: string[];
}

// "Outubro/26", "março/27". Só o nome do mês e um ano curto: é o que distingue o
// rótulo da grade de qualquer outro texto da aba.
const ROTULO_MES = /^[a-zç]+\/\d{2}$/;

export function lerGradeFaturamento(
	gestao: Gestao,
	spreadsheetId: string,
	aba: string,
	coordenacao: string | null,
	grade: string[][],
): GradeFaturamentoLida {
	const meses: FaturamentoLido[] = [];
	const ilegiveis: MetaIlegivel[] = [];
	const avisos: string[] = [];
	const vistos = new Set<string>();
	const cel = (l: number, c: number) => (grade[l]?.[c] ?? "").trim();
	const origem = (l: number, c: number) => `${spreadsheetId}#${aba}#${colunaParaLetra(c)}${l + 1}`;

	for (let l = 0; l + 2 < grade.length; l++) {
		const linha = grade[l] ?? [];
		for (let c = 0; c < linha.length; c++) {
			const rotulo = normalizarCabecalho(cel(l, c));
			if (!ROTULO_MES.test(rotulo)) continue;
			const mm = mesDoRotulo(rotulo);
			// A linha de baixo precisa dizer Previsto | Realizado: sem isso, um texto
			// qualquer no formato "mês/aa" viraria faturamento.
			if (
				!mm ||
				normalizarCabecalho(cel(l + 1, c)) !== "previsto" ||
				normalizarCabecalho(cel(l + 1, c + 1)) !== "realizado"
			) {
				continue;
			}
			// Ano pela gestão, nunca pelo rótulo — mesma regra das metas (blocos.ts).
			const ano = Number(mm) >= 10 ? gestao.anoInicio : gestao.anoInicio + 1;
			const mes = `${ano}-${mm}-01`;
			if (vistos.has(mes)) {
				avisos.push(`aba "${aba}": mês ${mm}/${ano} aparece duas vezes; vale a primeira (${origem(l, c)}).`);
				continue;
			}
			vistos.add(mes);

			const valor = (col: number, nome: string) => {
				const bruto = cel(l + 2, col);
				const n = parsearValorMeta(bruto);
				if (n === null) {
					ilegiveis.push({
						origemRef: origem(l + 2, col),
						rotulo: `${nome} ${cel(l, c)}${coordenacao ? ` ${coordenacao}` : ""}`,
						bruto,
						motivo: "valor de faturamento ilegível",
					});
				}
				return n;
			};
			meses.push({
				coordenacao,
				mes,
				previsto: valor(c, "previsto"),
				realizado: valor(c + 1, "realizado"),
				origemRef: origem(l, c),
			});
		}
	}

	if (meses.length === 0) avisos.push(`aba "${aba}": nenhuma grade de faturamento encontrada.`);
	return { meses, ilegiveis, avisos };
}
