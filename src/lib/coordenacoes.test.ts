import { describe, it, expect } from "vitest";
import {
	apenasCoordenacoes,
	ehCoordenacao,
	ehCrossSell,
	rotulosDesconhecidos,
} from "./coordenacoes";

// O array vem do Pipefy do jeito que a fonte mandou. Estes casos são reais,
// copiados do banco antes da correção de `extrairValores`.
const GALO_DOCE = ["316102076", "316102077", "316102080", "PRO", "MNP", "QAB"];
const FABIANO = ["316102079", "CCE"];
const TELEFONE_INFANTIL = ["317688210", "NP"];

describe("apenasCoordenacoes", () => {
	it("descarta os IDs internos do Pipefy", () => {
		expect(apenasCoordenacoes(GALO_DOCE)).toEqual(["MNP", "QAB", "PRO"]);
	});

	it("ordena canonicamente, não na ordem em que a fonte mandou", () => {
		// Duas exportações do mesmo card não podem gerar rótulos diferentes só
		// porque alguém marcou as caixas em outra sequência.
		expect(apenasCoordenacoes(["QAB", "CCE"])).toEqual(["CCE", "QAB"]);
		expect(apenasCoordenacoes(["CCE", "QAB"])).toEqual(["CCE", "QAB"]);
	});

	it("devolve vazio quando não há coordenação reconhecida", () => {
		expect(apenasCoordenacoes(TELEFONE_INFANTIL)).toEqual([]);
	});
});

describe("ehCrossSell", () => {
	it("NÃO é cross-sell só porque o array tem mais de um valor", () => {
		// Este era o bug: `coordenacoes.length > 1` dava verdadeiro em 2887 dos
		// 2930 cards, porque cada rótulo vinha acompanhado do seu ID.
		expect(FABIANO.length).toBeGreaterThan(1);
		expect(ehCrossSell(FABIANO)).toBe(false);
	});

	it("é cross-sell com duas coordenações reconhecidas", () => {
		expect(ehCrossSell(GALO_DOCE)).toBe(true);
	});

	it("um rótulo desconhecido ao lado de uma coordenação não faz cross-sell", () => {
		expect(ehCrossSell(["NP", "ACE"])).toBe(false);
	});
});

describe("rotulosDesconhecidos", () => {
	it("separa o que a fonte trouxe e não é coordenação", () => {
		// IDs também são desconhecidos — e é assim que se percebe contaminação
		// voltando, caso a precedência de `extrairValores` mude de novo.
		expect(rotulosDesconhecidos(["NP", "ACE"])).toEqual(["NP"]);
		expect(rotulosDesconhecidos(FABIANO)).toEqual(["316102079"]);
	});
});

describe("ehCoordenacao", () => {
	it("reconhece as cinco e recusa o resto", () => {
		expect(["CCE", "ACE", "MNP", "QAB", "PRO"].every(ehCoordenacao)).toBe(true);
		expect(["NP", "AN", "N2", "CONTRATO", "PAUSADO", ""].some(ehCoordenacao)).toBe(
			false,
		);
	});
});
