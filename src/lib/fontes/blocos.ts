// src/lib/fontes/blocos.ts
//
// Leitor da aba "Metas por coordenação", que NÃO é uma tabela.
//
// É um painel espacial: vários blocos independentes espalhados pela mesma
// grade, sem linha de cabeçalho única, misturando períodos e até gestões
// diferentes. Um parser por cabeçalho não lê isso — daí a estratégia "blocos".
//
// A regra de layout, verificada nas três planilhas: âncora numa coluna X ⇒ os
// rótulos ficam na própria coluna X e os valores em X+1. Blocos de ciclo têm
// ainda "FIM:" em X+1 e a data em X+2, na mesma linha da âncora.
//
//   B3  "METAS"                     E3  "Ciclo Waterloo"  F3 "FIM:"  G3 31/01/2025
//   B4  outubro/2024   C4  120.000  E4  "ACE"             F4  30.000
//   ...                             ...
//   B16 "total"        C16 1.234.567 E9 "Fluxo"           F9  300.000
//
// O que este módulo NÃO faz: adivinhar. Valor ilegível ("???" no 4º ciclo de
// 25/26) vira ausência registrada, nunca zero — meta não definida e meta de
// zero são coisas diferentes.

import { normalizarCabecalho } from "./normalizar";
import type { Ciclo, Gestao } from "./tipos";

/** As cinco coordenações; "Fluxo" é a linha de total do bloco. */
const COORDENACOES = ["CCE", "ACE", "MNP", "QAB", "PRO"];
const ROTULO_TOTAL = "fluxo";

const MESES_PT: Record<string, string> = {
	janeiro: "01",
	fevereiro: "02",
	marco: "03",
	abril: "04",
	maio: "05",
	junho: "06",
	julho: "07",
	agosto: "08",
	setembro: "09",
	outubro: "10",
	novembro: "11",
	dezembro: "12",
};

export interface MetaLida {
	tipo: "gestao" | "ciclo" | "mes";
	/** id do ciclo, "01".."12" para mês, ou o id da gestão. */
	periodo: string;
	/** null = meta geral da Fluxo. */
	coordenacao: string | null;
	valor: number;
	origemRef: string;
	/**
	 * true = não foi lida de uma célula, foi calculada. Hoje só ocorre na meta de
	 * gestão por coordenação de 23/24 e 24/25, somada a partir dos ciclos.
	 * A linhagem precisa saber disso: um número derivado apresentado como lido é
	 * exatamente o tipo de coisa que a auditoria existe para pegar.
	 */
	derivada?: boolean;
}

export interface MetaIlegivel {
	origemRef: string;
	rotulo: string;
	bruto: string;
	motivo: string;
}

export interface MetasLidas {
	gestao: string;
	metas: MetaLida[];
	ilegiveis: MetaIlegivel[];
	/**
	 * Algo saiu do esperado e alguém precisa olhar. Aviso que aparece em toda
	 * rodada deixa de ser lido — o que é rotina vai em `notas`.
	 */
	avisos: string[];
	/** Rotina: registra o que foi feito e por quê. Não pede ação. */
	notas: string[];
}

// ─── Utilitários ──────────────────────────────────────────────────

function celula(grade: string[][], linha: number, coluna: number): string {
	return (grade[linha]?.[coluna] ?? "").trim();
}

/**
 * Converte "R$ 1.234.567" em número. Devolve null quando não há valor
 * interpretável — inclusive nos placeholders "???" que a planilha de 25/26 usa
 * para meta ainda não definida.
 */
export function parsearValorMeta(bruto: string): number | null {
	const s = (bruto ?? "").trim();
	if (!s) return null;
	if (/^\?+$/.test(s)) return null;

	const limpo = s
		.replace(/R\$\s?/gi, "")
		.replace(/\s/g, "")
		.replace(/\./g, "")
		.replace(",", ".");

	if (!/^-?\d+(\.\d+)?$/.test(limpo)) return null;
	const n = parseFloat(limpo);
	return Number.isFinite(n) ? n : null;
}

/**
 * Extrai o mês de um rótulo como "outubro/2025".
 *
 * O ANO É DESCARTADO de propósito: na planilha de 25/26 os rótulos ficaram do
 * ano anterior ("outubro/2024".."setembro/2025") enquanto os valores são da
 * gestão corrente — a soma bate com a meta de gestão. Derivar o ano do rótulo
 * jogaria as metas de 25/26 dentro da gestão 24/25.
 */
export function mesDoRotulo(rotulo: string): string | null {
	const nome = normalizarCabecalho(rotulo).split("/")[0]?.trim();
	return MESES_PT[nome] ?? null;
}

/** Localiza a primeira linha em que `coluna` casa com o texto da âncora. */
function acharAncora(
	grade: string[][],
	coluna: number,
	texto: string,
): number | null {
	const alvo = normalizarCabecalho(texto);
	for (let i = 0; i < grade.length; i++) {
		if (normalizarCabecalho(celula(grade, i, coluna)) === alvo) return i;
	}
	return null;
}

// ─── Blocos ───────────────────────────────────────────────────────

/**
 * Bloco de metas mensais: âncora na coluna, meses abaixo, encerrado por "total".
 *
 * O corte em "total" é essencial: na planilha de 23/24 existe um segundo bloco
 * ("PROJETADO REALISTA") logo abaixo, na MESMA coluna, com os mesmos meses.
 * Ler a coluna de ponta a ponta misturaria meta com projeção.
 */
function lerBlocoMensal(
	grade: string[][],
	coluna: number,
	ancora: string,
	ancoraFim: string,
	ctx: { gestao: string; origem: (l: number, c: number) => string },
): { metas: MetaLida[]; ilegiveis: MetaIlegivel[]; avisos: string[] } {
	const metas: MetaLida[] = [];
	const ilegiveis: MetaIlegivel[] = [];
	const avisos: string[] = [];

	const inicio = acharAncora(grade, coluna, ancora);
	if (inicio === null) {
		avisos.push(`bloco mensal: âncora "${ancora}" não encontrada`);
		return { metas, ilegiveis, avisos };
	}

	const fimNormalizado = normalizarCabecalho(ancoraFim);

	for (let i = inicio + 1; i < grade.length; i++) {
		const rotulo = celula(grade, i, coluna);
		if (!rotulo) continue;

		// A linha "total" fecha o bloco e carrega a meta da gestão para a Fluxo.
		if (normalizarCabecalho(rotulo) === fimNormalizado) {
			const valor = parsearValorMeta(celula(grade, i, coluna + 1));
			if (valor !== null) {
				metas.push({
					tipo: "gestao",
					periodo: ctx.gestao,
					coordenacao: null,
					valor,
					origemRef: ctx.origem(i, coluna + 1),
				});
			}
			break;
		}

		const mes = mesDoRotulo(rotulo);
		if (!mes) {
			// Rótulo que não é mês antes do "total": o bloco tem algo inesperado.
			avisos.push(
				`bloco mensal: rótulo não reconhecido como mês na linha ${i + 1}: "${rotulo}"`,
			);
			continue;
		}

		const bruto = celula(grade, i, coluna + 1);
		const valor = parsearValorMeta(bruto);
		if (valor === null) {
			ilegiveis.push({
				origemRef: ctx.origem(i, coluna + 1),
				rotulo,
				bruto,
				motivo: bruto ? "valor não interpretável" : "célula vazia",
			});
			continue;
		}

		metas.push({
			tipo: "mes",
			periodo: mes,
			coordenacao: null,
			valor,
			origemRef: ctx.origem(i, coluna + 1),
		});
	}

	return { metas, ilegiveis, avisos };
}

/**
 * Bloco de metas de gestão POR COORDENAÇÃO. Só a planilha de 25/26 tem.
 *
 * A linha "Fluxo" deste bloco é lida mas NÃO vira meta: a meta de gestão da
 * Fluxo é a linha `total` do bloco mensal (decisão do dono do processo). As duas
 * teriam a mesma chave em `meta_unique_idx` e uma sobrescreveria a outra.
 *
 * As duas divergirem é ESPERADO, não defeito: são alvos definidos em momentos
 * diferentes. A divergência vira nota de rotina, não alarme.
 */
function lerBlocoGestao(
	grade: string[][],
	coluna: number,
	ancora: string,
	ctx: { gestao: string; origem: (l: number, c: number) => string },
): {
	metas: MetaLida[];
	ilegiveis: MetaIlegivel[];
	avisos: string[];
	totalDeclarado: number | null;
} {
	const metas: MetaLida[] = [];
	const ilegiveis: MetaIlegivel[] = [];
	const avisos: string[] = [];
	let totalDeclarado: number | null = null;

	const inicio = acharAncora(grade, coluna, ancora);
	if (inicio === null) return { metas, ilegiveis, avisos, totalDeclarado };

	for (let i = inicio + 1; i < grade.length; i++) {
		const rotulo = celula(grade, i, coluna);
		if (!rotulo) break; // linha em branco encerra o bloco

		const norm = normalizarCabecalho(rotulo);
		const ehTotal = norm === ROTULO_TOTAL;
		const coord = COORDENACOES.find((c) => normalizarCabecalho(c) === norm);

		if (!ehTotal && !coord) break; // saiu do bloco

		const bruto = celula(grade, i, coluna + 1);
		const valor = parsearValorMeta(bruto);
		if (valor === null) {
			ilegiveis.push({
				origemRef: ctx.origem(i, coluna + 1),
				rotulo,
				bruto,
				motivo: bruto ? "valor não interpretável" : "célula vazia",
			});
			continue;
		}

		// A linha "Fluxo" fica registrada só para a conferência abaixo.
		if (ehTotal) {
			totalDeclarado = valor;
			continue;
		}

		metas.push({
			tipo: "gestao",
			periodo: ctx.gestao,
			coordenacao: coord as string,
			valor,
			origemRef: ctx.origem(i, coluna + 1),
		});
	}

	return { metas, ilegiveis, avisos, totalDeclarado };
}

/**
 * Blocos de ciclo, empilhados verticalmente.
 *
 * O ciclo é identificado pelo MÊS da data em "FIM:", não pelo nome: o 4º ciclo
 * de 25/26 ainda se chama "Ciclo XXX" na planilha, um placeholder. A data é o
 * dado confiável; o nome é conferido depois e divergência vira aviso.
 */
function lerBlocosDeCiclo(
	grade: string[][],
	coluna: number,
	prefixo: string,
	gestao: Gestao,
	ctx: { origem: (l: number, c: number) => string },
): {
	metas: MetaLida[];
	ilegiveis: MetaIlegivel[];
	avisos: string[];
	notas: string[];
} {
	const metas: MetaLida[] = [];
	const ilegiveis: MetaIlegivel[] = [];
	const avisos: string[] = [];
	const notas: string[] = [];

	const prefixoNorm = normalizarCabecalho(prefixo);
	const vistos = new Set<string>();

	for (let i = 0; i < grade.length; i++) {
		const rotulo = celula(grade, i, coluna);
		if (!normalizarCabecalho(rotulo).startsWith(prefixoNorm)) continue;

		const dataFim = celula(grade, i, coluna + 2);
		const mesFim = /\d{1,2}\/(\d{1,2})\/\d{2,4}/.exec(dataFim)?.[1];
		if (!mesFim) {
			avisos.push(
				`bloco de ciclo "${rotulo}" (linha ${i + 1}): data FIM ilegível ("${dataFim}") — bloco ignorado`,
			);
			continue;
		}

		const mm = mesFim.padStart(2, "0");
		const ciclo: Ciclo | undefined = gestao.ciclos.find((c) => c.mesFim === mm);
		if (!ciclo) {
			avisos.push(
				`bloco de ciclo "${rotulo}" termina em ${dataFim}, que não corresponde a nenhum ciclo do registry — bloco ignorado`,
			);
			continue;
		}

		if (normalizarCabecalho(ciclo.rotulo) !== normalizarCabecalho(rotulo)) {
			// Nome divergente é ROTINA: o ciclo só é batizado quando chega a vez
			// dele, e até lá a planilha usa placeholder. O casamento é pela data
			// FIM, então a divergência não afeta dado nenhum.
			//
			// A exceção que MERECE ação: o registry ainda tem nome provisório e a
			// planilha já revelou o definitivo.
			if (ciclo.rotuloProvisorio) {
				avisos.push(
					`ciclo "${ciclo.id}": a planilha já revelou o nome "${rotulo}" — atualizar o rótulo no registry e remover rotuloProvisorio.`,
				);
			} else {
				notas.push(
					`ciclo "${ciclo.id}": registry usa "${ciclo.rotulo}", planilha ainda usa "${rotulo}" (casados pela data FIM ${dataFim}).`,
				);
			}
		}
		if (vistos.has(ciclo.id)) {
			avisos.push(`ciclo "${ciclo.id}" aparece em mais de um bloco`);
		}
		vistos.add(ciclo.id);

		for (let j = i + 1; j < grade.length; j++) {
			const linhaRotulo = celula(grade, j, coluna);
			if (!linhaRotulo) break;

			const norm = normalizarCabecalho(linhaRotulo);
			if (norm.startsWith(prefixoNorm)) break; // começou o próximo ciclo

			const ehTotal = norm === ROTULO_TOTAL;
			const coord = COORDENACOES.find((c) => normalizarCabecalho(c) === norm);
			if (!ehTotal && !coord) break;

			const bruto = celula(grade, j, coluna + 1);
			const valor = parsearValorMeta(bruto);
			if (valor === null) {
				ilegiveis.push({
					origemRef: ctx.origem(j, coluna + 1),
					rotulo: `${ciclo.id} / ${linhaRotulo}`,
					bruto,
					motivo: bruto
						? "meta ainda não definida na planilha"
						: "célula vazia",
				});
				continue;
			}

			metas.push({
				tipo: "ciclo",
				periodo: ciclo.id,
				coordenacao: ehTotal ? null : (coord as string),
				valor,
				origemRef: ctx.origem(j, coluna + 1),
			});
		}
	}

	const faltando = gestao.ciclos.filter((c) => !vistos.has(c.id));
	if (faltando.length > 0) {
		avisos.push(
			`sem bloco na planilha para o(s) ciclo(s): ${faltando.map((c) => c.id).join(", ")}`,
		);
	}

	return { metas, ilegiveis, avisos, notas };
}

// ─── Entrada pública ──────────────────────────────────────────────

export function lerMetas(gestao: Gestao, grade: string[][]): MetasLidas {
	const fonte = gestao.metas;
	if (!fonte) {
		return {
			gestao: gestao.id,
			metas: [],
			ilegiveis: [],
			avisos: ["sem fonte de metas no registry"],
			notas: [],
		};
	}

	const origem = (linha: number, coluna: number) =>
		`${fonte.spreadsheetId}#${fonte.aba}#${colunaParaLetra(coluna)}${linha + 1}`;

	const ctx = { gestao: gestao.id, origem };

	const mensal = lerBlocoMensal(
		grade,
		fonte.colunaBlocosB,
		fonte.ancoraMensal,
		fonte.ancoraFimMensal,
		ctx,
	);
	const porGestao = fonte.ancoraGestao
		? lerBlocoGestao(grade, fonte.colunaBlocosB, fonte.ancoraGestao, ctx)
		: { metas: [], ilegiveis: [], avisos: [], totalDeclarado: null };

	// A meta de gestão da Fluxo vem do `total` do bloco mensal. Se o bloco
	// GESTÃO declara um total diferente, a soma das partes não reconstrói o todo
	// — fato da fonte que precisa ficar visível, não ser escolhido em silêncio.
	const notasDaGestao: string[] = [];
	const gestaoFluxo = mensal.metas.find((m) => m.tipo === "gestao");
	if (
		porGestao.totalDeclarado !== null &&
		gestaoFluxo &&
		Math.abs(porGestao.totalDeclarado - gestaoFluxo.valor) > 0.01
	) {
		notasDaGestao.push(
			`meta de gestão da Fluxo: ${gestaoFluxo.valor.toLocaleString("pt-BR")}, ` +
				`da linha "${fonte.ancoraFimMensal}" do bloco mensal — é sempre essa. ` +
				`O bloco "${fonte.ancoraGestao}" soma ${porGestao.totalDeclarado.toLocaleString("pt-BR")} ` +
				`nas coordenações; divergir é esperado.`,
		);
	}
	const ciclos = lerBlocosDeCiclo(
		grade,
		fonte.colunaBlocosCiclo,
		fonte.prefixoCiclo,
		gestao,
		ctx,
	);

	// Se a planilha não traz o bloco de coordenações na gestão, a meta de cada
	// coordenação é a soma dos ciclos dela. Vale para 23/24 e 24/25, que já
	// estão encerradas; de 25/26 em diante o bloco existe e é lido.
	const derivadas =
		porGestao.metas.length === 0
			? derivarGestaoPorCoordenacao(gestao, ciclos.metas)
			: { metas: [], avisos: [], notas: [] };

	const metas = [
		...mensal.metas,
		...porGestao.metas,
		...derivadas.metas,
		...ciclos.metas,
	];

	return {
		gestao: gestao.id,
		metas,
		ilegiveis: [...mensal.ilegiveis, ...porGestao.ilegiveis, ...ciclos.ilegiveis],
		avisos: [
			...mensal.avisos,
			...porGestao.avisos,
			...ciclos.avisos,
			...derivadas.avisos,
			...detectarColisoes(metas),
		],
		notas: [...notasDaGestao, ...ciclos.notas, ...derivadas.notas],
	};
}

/**
 * Meta de gestão por coordenação, somada a partir dos ciclos.
 *
 * Só deriva quando a coordenação tem meta em TODOS os ciclos da gestão. Somar
 * um subconjunto produziria um alvo menor que o real, e o número passaria por
 * verdadeiro — pior que não ter número nenhum.
 */
function derivarGestaoPorCoordenacao(
	gestao: Gestao,
	metasDeCiclo: MetaLida[],
): { metas: MetaLida[]; avisos: string[]; notas: string[] } {
	const metas: MetaLida[] = [];
	const avisos: string[] = [];
	const notas: string[] = [];

	for (const coord of COORDENACOES) {
		const doCoord = metasDeCiclo.filter((m) => m.coordenacao === coord);
		const ciclosCobertos = new Set(doCoord.map((m) => m.periodo));
		const faltando = gestao.ciclos.filter((c) => !ciclosCobertos.has(c.id));

		if (doCoord.length === 0) continue;

		if (faltando.length > 0) {
			avisos.push(
				`meta de gestão de ${coord} NÃO derivada: falta meta no(s) ciclo(s) ` +
					`${faltando.map((c) => c.id).join(", ")}. Somar só os disponíveis daria um alvo menor que o real.`,
			);
			continue;
		}

		metas.push({
			tipo: "gestao",
			periodo: gestao.id,
			coordenacao: coord,
			valor: doCoord.reduce((s, m) => s + m.valor, 0),
			origemRef: `derivado: soma das metas de ciclo de ${coord} (${doCoord
				.map((m) => m.periodo)
				.join(" + ")})`,
			derivada: true,
		});
	}

	if (metas.length > 0) {
		notas.push(
			`sem bloco de coordenações na gestão: ${metas.length} meta(s) derivada(s) somando os ciclos.`,
		);
	}

	return { metas, avisos, notas };
}

/**
 * Duas metas com a mesma (tipo, período, coordenação) não podem coexistir: é
 * exatamente a chave de `meta_unique_idx` no banco. Gravar as duas faria uma
 * sobrescrever a outra na ordem em que chegassem — dado que muda sozinho entre
 * execuções, sem ninguém perceber.
 *
 * Caso real: na planilha de 25/26, a linha "total" do bloco METAS (soma das
 * mensais) e a linha "Fluxo" do bloco GESTÃO (soma das coordenações) descrevem
 * as duas a meta de gestão da Fluxo — com valores diferentes.
 */
function detectarColisoes(metas: MetaLida[]): string[] {
	const porChave = new Map<string, MetaLida[]>();

	for (const m of metas) {
		const chave = `${m.tipo}|${m.periodo}|${m.coordenacao ?? "GERAL"}`;
		porChave.set(chave, [...(porChave.get(chave) ?? []), m]);
	}

	return [...porChave.entries()]
		.filter(([, lista]) => lista.length > 1)
		.map(
			([chave, lista]) =>
				`COLISÃO em ${chave}: ${lista.length} metas com a mesma chave — ` +
				lista
					.map((m) => `${m.valor.toLocaleString("pt-BR")} (${m.origemRef.split("#").pop()})`)
					.join(" × ") +
				`. Uma sobrescreveria a outra no banco; é preciso decidir qual vale.`,
		);
}

function colunaParaLetra(indice: number): string {
	let n = indice;
	let s = "";
	do {
		s = String.fromCharCode(65 + (n % 26)) + s;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return s;
}
