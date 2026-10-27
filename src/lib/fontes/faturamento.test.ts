import { describe, expect, it } from "vitest";

import { lerGradeFaturamento } from "./faturamento";
import { GESTOES } from "./registry";

const G2627 = GESTOES.find((g) => g.id === "26/27")!;

// Recorte da aba "Visão Geral" de "Fluxo Faturado por Mês 26/27" (out/2026),
// com os cabeçalhos de cima (que têm "Faturamento" mas não são a grade).
const VISAO_GERAL = [
	["Fluxo"],
	["", "", "Projetos", "", "", "Métrica - Geral"],
	["", "", "Em andamento", "Paralisado", "", "Faturamento", "", "Valor Vendido", "Projetos Entregues"],
	["", "", "36", "0", "", "R$ 87.848,89", "", "", "#REF!"],
	[],
	["", "Outubro/26", "", "Novembro/26", "", "Dezembro/26"],
	["", "Previsto", "Realizado", "Previsto", "Realizado", "Previsto", "Realizado"],
	["", "R$ 166.340,68", "R$ 87.848,89", "R$ 72.425,64", "R$ 0,00", "R$ 32.384,60", "#REF!"],
	["", "Abril/27", "", "Setembro/27"],
	["", "Previsto", "Realizado", "Previsto", "Realizado"],
	["", "R$ 0,00", "R$ 0,00", "R$ 1.666,67", "R$ 0,00"],
];

describe("lerGradeFaturamento", () => {
	const lida = lerGradeFaturamento(G2627, "PLAN", "Visão Geral", null, VISAO_GERAL);

	it("lê previsto e realizado por mês, com o ano pela gestão", () => {
		expect(lida.meses.map((m) => [m.mes, m.previsto, m.realizado])).toEqual([
			["2026-10-01", 166340.68, 87848.89],
			["2026-11-01", 72425.64, 0],
			["2026-12-01", 32384.6, null],
			["2027-04-01", 0, 0],
			["2027-09-01", 1666.67, 0],
		]);
		expect(lida.meses[0]).toMatchObject({ coordenacao: null, origemRef: "PLAN#Visão Geral#B6" });
	});

	it("célula ilegível vira null com motivo, não zero", () => {
		expect(lida.ilegiveis).toEqual([
			expect.objectContaining({ origemRef: "PLAN#Visão Geral#G8", bruto: "#REF!" }),
		]);
	});

	it("rótulo de mês sem Previsto/Realizado embaixo não é grade", () => {
		const solta = lerGradeFaturamento(G2627, "P", "X", "ACE", [["Outubro/26"], ["algo"], ["R$ 1"]]);
		expect(solta.meses).toEqual([]);
		expect(solta.avisos[0]).toMatch(/nenhuma grade/);
	});
});
