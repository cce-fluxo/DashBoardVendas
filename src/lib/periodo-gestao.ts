// src/lib/periodo-gestao.ts
//
// Utilitário de janela de período por gestão.
//
// A gestão da Fluxo vai de 01/out a 30/set:
//   - "25/26"  →  01/10/2025 00:00 (BRT)  até  30/09/2026 23:59 (BRT)
//   - "24/25"  →  01/10/2024 00:00 (BRT)  até  30/09/2025 23:59 (BRT)
//
// Usado na LEITURA: todo recorte de período (vendas e funil) passa por aqui.
// A ingestão não filtra por data — grava todos os cards dos pipes.
//
// Âncora em horário de Brasília (UTC-03:00; o Brasil não tem horário de verão
// desde 2019) para ser determinístico independente do fuso do servidor —
// a Vercel roda em UTC.

import { PeriodoGestao, PeriodoCiclo, SelecaoPeriodoFunil } from "@/types";
import { buscarGestao, gestaoPadraoDaTela } from "@/lib/fontes/registry";
import { mesesDoCiclo } from "@/lib/fontes/calendario";

const OFFSET_BRASIL = "-03:00";

/**
 * Gestão que as telas e a API mostram por padrão: a vigente na data de hoje, ou
 * a mais recente cadastrada enquanto a vigente não tem fonte no registry.
 *
 * Era a constante `GESTAO_ATUAL = "25/26"`. Constante significava editar código
 * todo 1º de outubro — e esquecer disso faria o dashboard mostrar a gestão
 * errada em todas as telas sem avisar.
 *
 * Só serve de DEFAULT de leitura. Quem precisa do calendário puro (ingestão)
 * usa `idGestaoVigente` direto.
 */
export function gestaoAtual(hoje: Date = new Date()): PeriodoGestao {
	return gestaoPadraoDaTela(hoje);
}

/**
 * Gestão anterior a uma dada. Aritmética, não tabela.
 * "25/26" → "24/25".
 */
export function gestaoAnterior(gestao: PeriodoGestao): PeriodoGestao {
	const ano = anoInicioGestao(gestao) - 1;
	const aa = String(ano % 100).padStart(2, "0");
	const bb = String((ano + 1) % 100).padStart(2, "0");
	return `${aa}/${bb}`;
}

function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

export interface JanelaPeriodo {
	inicio: Date;
	fim: Date;
	inicioISO: string;
	fimISO: string;
}

/** "25/26" → 2025 ; "24/25" → 2024 */
export function anoInicioGestao(gestao: PeriodoGestao): number {
	const [aa] = gestao.split("/");
	return 2000 + parseInt(aa, 10);
}

/** Janela [início, fim] da gestão, ancorada em horário de Brasília. */
export function janelaGestao(
	gestao: PeriodoGestao = gestaoAtual(),
): JanelaPeriodo {
	const ano = anoInicioGestao(gestao);
	const inicioISO = `${ano}-10-01T00:00:00.000${OFFSET_BRASIL}`;
	const fimISO = `${ano + 1}-09-30T23:59:59.999${OFFSET_BRASIL}`;
	return {
		inicio: new Date(inicioISO),
		fim: new Date(fimISO),
		inicioISO,
		fimISO,
	};
}

/**
 * Janela [início, fim] de um mês dentro da gestão, ancorada em horário de Brasília.
 *
 * O ano do mês segue a regra da gestão: meses 10–12 caem no 1º ano (out/nov/dez);
 * meses 01–09 caem no 2º ano. Ex.: mês "11" da gestão "25/26" → nov/2025;
 * mês "03" da mesma gestão → mar/2026.
 *
 * @param mes string "01".."12" (zero-padded).
 */
export function janelaMes(
	mes: string,
	gestao: PeriodoGestao = gestaoAtual(),
): JanelaPeriodo {
	const anoInicio = anoInicioGestao(gestao);
	const mm = parseInt(mes, 10);
	const ano = mm >= 10 ? anoInicio : anoInicio + 1;
	// Dia 0 do mês seguinte (1-base) = último dia deste mês.
	const ultimoDia = new Date(Date.UTC(ano, mm, 0)).getUTCDate();
	const inicioISO = `${ano}-${pad2(mm)}-01T00:00:00.000${OFFSET_BRASIL}`;
	const fimISO = `${ano}-${pad2(mm)}-${pad2(ultimoDia)}T23:59:59.999${OFFSET_BRASIL}`;
	return {
		inicio: new Date(inicioISO),
		fim: new Date(fimISO),
		inicioISO,
		fimISO,
	};
}

/**
 * Janela [início, fim] de um ciclo dentro da gestão.
 *
 * Os meses vêm do REGISTRY, não de uma tabela fixa: cada gestão define quantos
 * ciclos tem e quais meses cada um cobre. Havia três cópias de um calendário
 * trimestral hardcoded neste projeto, e todas as três estavam erradas para
 * 23/24 e 24/25, que usam 3 ciclos de 4 meses.
 */
export function janelaCiclo(
	ciclo: PeriodoCiclo,
	gestao: PeriodoGestao = gestaoAtual(),
): JanelaPeriodo {
	const meses = mesesDoCicloDaGestao(ciclo, gestao);
	const ini = janelaMes(meses[0], gestao);
	const f = janelaMes(meses[meses.length - 1], gestao);
	return {
		inicio: ini.inicio,
		fim: f.fim,
		inicioISO: ini.inicioISO,
		fimISO: f.fimISO,
	};
}

/**
 * Meses cobertos por um ciclo, na ordem da gestão (Out→Set).
 * Lança se o ciclo não existir na gestão — id inválido é erro de programação,
 * não algo para tratar com um array vazio que vira soma zero em silêncio.
 */
export function mesesDoCicloDaGestao(
	ciclo: PeriodoCiclo,
	gestao: PeriodoGestao = gestaoAtual(),
): string[] {
	const g = buscarGestao(gestao);
	const c = g.ciclos.find((x) => x.id === ciclo);
	if (!c) {
		throw new Error(
			`Ciclo "${ciclo}" não existe na gestão ${gestao}. ` +
				`Ciclos dessa gestão: ${g.ciclos.map((x) => x.id).join(", ")}.`,
		);
	}
	return mesesDoCiclo(c);
}

/** Rótulo legível de um período. "Ciclo Waterloo · Out/2024–Jan/2025". */
export function rotuloCiclo(
	ciclo: PeriodoCiclo,
	gestao: PeriodoGestao = gestaoAtual(),
): string {
	const g = buscarGestao(gestao);
	const c = g.ciclos.find((x) => x.id === ciclo);
	if (!c) return ciclo;

	const meses = mesesDoCiclo(c);
	const anoDe = (mes: string) =>
		parseInt(mes, 10) >= 10 ? g.anoInicio : g.anoInicio + 1;
	const nome = (mes: string) => NOMES_CURTOS[mes] ?? mes;

	const primeiro = meses[0];
	const ultimo = meses[meses.length - 1];
	return (
		`${c.rotulo} · ${nome(primeiro)}/${anoDe(primeiro)}` +
		`–${nome(ultimo)}/${anoDe(ultimo)}`
	);
}

const NOMES_CURTOS: Record<string, string> = {
	"01": "Jan", "02": "Fev", "03": "Mar", "04": "Abr",
	"05": "Mai", "06": "Jun", "07": "Jul", "08": "Ago",
	"09": "Set", "10": "Out", "11": "Nov", "12": "Dez",
};

/** Resolve a janela de data de qualquer seleção de período. */
export function janelaPeriodo(sel: SelecaoPeriodoFunil): JanelaPeriodo {
	if (sel.tipo === "mes" && sel.mes) return janelaMes(sel.mes, sel.gestao);
	if (sel.tipo === "ciclo" && sel.ciclo)
		return janelaCiclo(sel.ciclo, sel.gestao);
	return janelaGestao(sel.gestao);
}

/** Dias inteiros decorridos de `a` até `b` (negativo se b < a). */
export function diasEntre(a: Date, b: Date): number {
	return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * O card (pela data de criação) cai dentro da janela da gestão?
 * Datas inválidas ou ausentes retornam false (card fica de fora).
 */
export function dentroDaJanela(
	dataCriacao: string | Date | null | undefined,
	gestao: PeriodoGestao = gestaoAtual(),
): boolean {
	if (!dataCriacao) return false;
	const d =
		typeof dataCriacao === "string" ? new Date(dataCriacao) : dataCriacao;
	if (isNaN(d.getTime())) return false;
	const { inicio, fim } = janelaGestao(gestao);
	return d >= inicio && d <= fim;
}
