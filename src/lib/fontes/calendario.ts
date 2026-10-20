// src/lib/fontes/calendario.ts
//
// Validação do calendário de ciclos declarado no registry.
//
// A gestão vai de outubro a setembro. Os ciclos de uma gestão precisam ser
// contíguos e cobrir os 12 meses, sem buraco e sem sobreposição — se não
// cobrirem, existe um mês que não pertence a ciclo nenhum, e qualquer soma por
// ciclo passa a divergir do total da gestão sem que ninguém veja.
//
// Isto não é hipotético: a planilha de 23/24 registra "Ciclo Andes" com FIM em
// 30/05/2024, e maio tem 31 dias. Se o calendário fosse lido literalmente da
// planilha, 31/05/2024 ficaria órfão.

import type { Ciclo, Gestao } from "./tipos";

/** Meses da gestão, na ordem: outubro a setembro. */
export const MESES_DA_GESTAO = [
	"10", "11", "12", "01", "02", "03", "04", "05", "06", "07", "08", "09",
] as const;

const RE_GESTAO = /^(\d{2})\/(\d{2})$/;

/** Posição do mês dentro da gestão (0 = outubro, 11 = setembro). */
export function posicaoNaGestao(mes: string): number {
	return (MESES_DA_GESTAO as readonly string[]).indexOf(mes);
}

/**
 * Meses cobertos por um ciclo, na ordem da gestão.
 * Aceita ciclo que vira o ano civil (ex.: Out→Jan).
 */
export function mesesDoCiclo(ciclo: Ciclo): string[] {
	const ini = posicaoNaGestao(ciclo.mesInicio);
	const fim = posicaoNaGestao(ciclo.mesFim);
	if (ini < 0 || fim < 0 || fim < ini) return [];
	return MESES_DA_GESTAO.slice(ini, fim + 1);
}

export interface ProblemaCalendario {
	gestao: string;
	problema: string;
}

/**
 * Verifica uma gestão. Devolve a lista de problemas — vazia significa válida.
 */
export function verificarGestao(gestao: Gestao): ProblemaCalendario[] {
	const p: ProblemaCalendario[] = [];
	const reportar = (problema: string) => p.push({ gestao: gestao.id, problema });

	const m = RE_GESTAO.exec(gestao.id);
	if (!m) {
		reportar(`id "${gestao.id}" não está no formato AA/BB`);
	} else {
		const aa = parseInt(m[1], 10);
		const bb = parseInt(m[2], 10);
		if ((aa + 1) % 100 !== bb) {
			reportar(`id "${gestao.id}": o segundo ano deveria ser o primeiro + 1`);
		}
		if (gestao.anoInicio % 100 !== aa) {
			reportar(
				`anoInicio ${gestao.anoInicio} não corresponde ao id "${gestao.id}"`,
			);
		}
	}

	if (gestao.ciclos.length === 0) {
		reportar("nenhum ciclo declarado");
		return p;
	}

	const idsVistos = new Set<string>();
	for (const c of gestao.ciclos) {
		if (idsVistos.has(c.id)) reportar(`id de ciclo repetido: "${c.id}"`);
		idsVistos.add(c.id);

		if (posicaoNaGestao(c.mesInicio) < 0) {
			reportar(`ciclo "${c.id}": mesInicio "${c.mesInicio}" inválido`);
		}
		if (posicaoNaGestao(c.mesFim) < 0) {
			reportar(`ciclo "${c.id}": mesFim "${c.mesFim}" inválido`);
		}
		if (mesesDoCiclo(c).length === 0) {
			reportar(
				`ciclo "${c.id}": intervalo ${c.mesInicio}→${c.mesFim} é vazio ou está fora de ordem na gestão`,
			);
		}
	}

	// Cobertura: cada mês da gestão pertence a exatamente um ciclo.
	const dono = new Map<string, string[]>();
	for (const c of gestao.ciclos) {
		for (const mes of mesesDoCiclo(c)) {
			dono.set(mes, [...(dono.get(mes) ?? []), c.id]);
		}
	}

	const semCiclo = MESES_DA_GESTAO.filter((mes) => !dono.has(mes));
	if (semCiclo.length > 0) {
		reportar(`mês(es) sem ciclo: ${semCiclo.join(", ")}`);
	}

	for (const [mes, ciclos] of dono) {
		if (ciclos.length > 1) {
			reportar(`mês ${mes} pertence a mais de um ciclo: ${ciclos.join(", ")}`);
		}
	}

	return p;
}

/**
 * Valida todas as gestões do registry. Lança na primeira falha, com o relatório
 * completo — um calendário inválido produz números errados em silêncio, então
 * é melhor não subir do que subir errado.
 */
export function validarCalendario(gestoes: Gestao[]): void {
	const problemas = gestoes.flatMap(verificarGestao);
	if (problemas.length === 0) return;

	throw new Error(
		`Calendário de gestões inválido no registry:\n` +
			problemas.map((x) => `  - [${x.gestao}] ${x.problema}`).join("\n"),
	);
}
