import { describe, expect, it } from "vitest";

import { lerIndicacoes } from "./indicacoes";

const CAB = ["Carimbo de data/hora", "Seu nome, caveira", "Qual a sua coordenação de origem?", "Nome do Contato\n(ex: Fulano)", "Telefone para Contato"];

describe("lerIndicacoes", () => {
	it("lê quem indicou e a coordenação, sem os dados do contato", () => {
		const r = lerIndicacoes("ID", "Aba", [
			CAB,
			["07/11/2026 10:00:00", " Ana  Souza ", "CCE", "Fulano", "21999999999"],
			[],
			["07/11/2026 10:05:00", "", "ACE"],
			["07/11/2026 10:00:00", "Ana Souza", "CCE"],
		]);
		expect(r.indicacoes).toEqual([{ carimbo: "07/11/2026 10:00:00", indicador: "Ana Souza", coordenacao: "CCE", origemRef: "ID#Aba#2" }]);
		expect(r.ignoradas).toBe(1);
		expect(r.rejeitadas.map((x) => x.motivo)).toEqual(["sem o nome de quem indicou", "resposta repetida (Ana Souza, 07/11/2026 10:00:00)"]);
		expect(r.cabecalhoOk).toBe(true);
	});

	it("cabeçalho irreconhecível não lê nada e avisa", () => {
		const r = lerIndicacoes("ID", "Aba", [["Data", "Nome"], ["x", "y"]]);
		expect(r).toMatchObject({ indicacoes: [], cabecalhoOk: false });
		expect(r.avisos).toHaveLength(1);
	});
});
