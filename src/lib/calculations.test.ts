import { describe, it, expect } from "vitest";
import {
	calcularKPIsPorCoordenacao,
	negociacoesSemCoordenacao,
} from "./calculations";
import type { CardComHistorico } from "./supabase-funil";

function card(p: Partial<CardComHistorico>): CardComHistorico {
	return {
		id_card: 1,
		pipe_id: "306460930",
		nome_card: "card",
		etapa_atual: "Follow-up",
		coordenacao: null,
		valor_contrato: null,
		data_criacao: "2026-07-01T00:00:00Z",
		coordenacoes: [],
		historico: [],
		...p,
	} as CardComHistorico;
}

// Casos reais do board, colhidos no diagnóstico.
const CARDS = [
	card({ id_card: 1, nome_card: "MC Lojão Teta", etapa_atual: "Follow-up", coordenacoes: ["QAB"], valor_contrato: 15000 }),
	// Precificação SEM valor: é o estado normal da fase, não registro inválido.
	card({ id_card: 2, nome_card: "Iota - Reforma + DI", etapa_atual: "Precificação/Aprovação em andamento", coordenacoes: ["ACE"], valor_contrato: null }),
	// Cross-sell de verdade: duas coordenações reconhecidas.
	card({ id_card: 3, nome_card: "Doceria Eta", etapa_atual: "Proposta comercial feita", coordenacoes: ["316102076", "316102080", "PRO", "QAB"], valor_contrato: 20000 }),
	// "NP" não é coordenação: não cai em linha nenhuma.
	card({ id_card: 4, nome_card: "EV + AR Brinquedos Capa", etapa_atual: "Follow-up", coordenacoes: ["317688210", "NP"], valor_contrato: 8000 }),
	// Fora das 3 fases de negociação.
	card({ id_card: 5, nome_card: "vendido", etapa_atual: "Venda", coordenacoes: ["QAB"], valor_contrato: 99000 }),
];

const linhas = calcularKPIsPorCoordenacao([], CARDS);
const linha = (c: string) => linhas.find((l) => l.coordenacao === c)!;

describe("calcularKPIsPorCoordenacao — projetos em negociação", () => {
	it("conta Precificação sem valor de proposta", () => {
		// Antes era descartado: sumia da contagem E da lista, sem nada indicando.
		expect(linha("ACE").projetosEmNegociacao.map((p) => p.titulo)).toEqual([
			"Iota - Reforma + DI",
		]);
	});

	it("não soma valor de quem não tem valor", () => {
		// Contar o projeto e somar R$ 0 são coisas diferentes.
		expect(linha("ACE").valorAFechar).toBe(0);
	});

	it("põe o cross-sell nas duas coordenações, em cheio", () => {
		expect(linha("PRO").projetosEmNegociacao.map((p) => p.titulo)).toEqual(["Doceria Eta"]);
		expect(linha("QAB").projetosEmNegociacao.map((p) => p.titulo)).toContain("Doceria Eta");
		expect(linha("PRO").valorAFechar).toBe(20000);
	});

	it("marca cross-sell por coordenação reconhecida, não por tamanho do array", () => {
		const galo = linha("PRO").projetosEmNegociacao.find((p) => p.titulo === "Doceria Eta")!;
		expect(galo.isCrossSell).toBe(true);
		expect(galo.coordenacoes).toEqual(["QAB", "PRO"]);

		const lo = linha("QAB").projetosEmNegociacao.find((p) => p.titulo === "MC Lojão Teta")!;
		expect(lo.isCrossSell).toBe(false);
	});

	it("ignora fases fora da negociação", () => {
		expect(linha("QAB").projetosEmNegociacao.map((p) => p.titulo)).not.toContain("vendido");
	});
});

describe("negociacoesSemCoordenacao", () => {
	it("expõe o que não cai em linha nenhuma", () => {
		const orfaos = negociacoesSemCoordenacao(CARDS);
		expect(orfaos.quantidade).toBe(1);
		expect(orfaos.valor).toBe(8000);
		// O rótulo nomeia o erro de preenchimento; o ID mostra contaminação.
		expect(orfaos.rotulos).toContain("NP");
	});

	it("não conta cards fora das 3 fases", () => {
		const orfaos = negociacoesSemCoordenacao([
			card({ id_card: 9, etapa_atual: "Perdido", coordenacoes: ["NP"] }),
		]);
		expect(orfaos.quantidade).toBe(0);
	});
});
