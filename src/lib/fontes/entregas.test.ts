import { describe, expect, it } from "vitest";

import { lerProjetos } from "./entregas";

// Recorte de "Projetos - Entregues" (out/2026): "Coordenação" sobre o checkbox
// da coluna A, e as linhas de ACE com a gestão duas colunas à direita.
const CAB = ["Coordenação", " ", "Projeto", "Prev. Prazo", "Data de finalização", "Tamanho da Equipe", "Prazo Real", "VV", "Fat", "Gestão - Venda", "Gestão - Entrega", "Custo"];
const linha = (vals: Record<number, string>) => Array.from({ length: 14 }, (_, i) => vals[i] ?? "");

describe("lerProjetos", () => {
	const lidos = lerProjetos("entregue", "P", "E", [
		CAB,
		// Com Prazo Real, ele vale; "Data de finalização" só quando ele falta.
		linha({ 0: "TRUE", 1: "CCE", 2: "DEV Samba", 3: "Finalizado", 4: "08/11/2025", 5: "4", 6: "12/11/2025", 9: "24/25", 10: "25/26" }),
		// ACE deslocada: no lugar da gestão, o faturado; Prazo Real duas colunas
		// adiante, como número de série em moeda. "08/03/1900" é duração, não data.
		linha({ 0: "TRUE", 1: "ACE ", 2: "Reforma Igreja", 5: "6", 6: "08/03/1900", 8: "R$ 46.197,00", 9: "R$ 9.984,00", 10: "R$ 9.984,00", 11: "25/26", 12: "25/26" }),
		// ACE deslocada com a gestão da venda vazia: só o "-" denuncia.
		linha({ 0: "TRUE", 1: "ACE", 2: "Vistoria", 9: "R$ 6.500,00", 12: "-" }),
		// PRO sem data de finalização: vale o Prazo Real.
		linha({ 0: "TRUE", 1: "PRO", 2: "AF Benuá", 5: "3", 6: "11/05/2026", 9: "25/26", 10: "25/26" }),
		linha({}),
		linha({ 0: "TRUE", 2: "Sem coordenação" }),
	]);

	it("acha a coordenação fora da coluna do cabeçalho e as gestões deslocadas", () => {
		expect(lidos.projetos.map((p) => [p.coordenacao, p.projeto, p.gestaoVenda, p.gestaoEntrega, p.dataEntrega, p.tamanhoEquipe])).toEqual([
			["CCE", "DEV Samba", "24/25", "25/26", "2025-11-12", 4],
			["ACE", "Reforma Igreja", "25/26", "25/26", "2026-06-24", 6],
			["ACE", "Vistoria", null, null, null, null],
			["PRO", "AF Benuá", "25/26", "25/26", "2026-05-11", 3],
		]);
	});

	it("equipe: gerente e consultores, sem vazio nem \"-\"", () => {
		const r = lerProjetos("entregue", "P", "E", [
			["Coordenação", "Projeto", "Gestão - Venda", "Gerente", "Consultor 1", "Consultor 2", "Consultor 3", "Gerente"],
			["CCE", "App", "25/26", "Mariana Fonceca", "Gabriel Santos", "-", "", "Peso"],
		]);
		expect(r.projetos[0].equipe).toEqual(["Mariana Fonceca", "Gabriel Santos"]);
	});

	it("linha vazia é ignorada; sem coordenação é rejeitada com motivo", () => {
		expect(lidos.ignoradas).toBe(1);
		expect(lidos.rejeitadas).toEqual([expect.objectContaining({ origemRef: "P#E#7", motivo: "coordenação ausente ou inválida" })]);
	});

	it("em execução pula o que já está finalizado", () => {
		const atual = lerProjetos("em_execucao", "P", "A", [
			["Histórico", "Finalizado?", "Coordenação", "Projeto", "Gestão - Venda"],
			["", "FALSE", "ACE", "PPCI", "23/24"],
			["", "TRUE", "MNP", "Carreta", "24/25"],
		]);
		expect(atual.projetos.map((p) => p.projeto)).toEqual(["PPCI"]);
		expect(atual.ignoradas).toBe(1);
	});
});
