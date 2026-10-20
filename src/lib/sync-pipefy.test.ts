import { describe, it, expect } from "vitest";
import { extrairValores, type CampoDoCard } from "./sync-pipefy";
import { buscarPipe } from "./fontes/pipes";

const PIPE = buscarPipe("306460930")!; // CRM COM

// Payloads reais da API do Pipefy, copiados durante o diagnóstico.
//
// A regra que estes casos travam: `value` traz os RÓTULOS, `array_value` traz
// os IDs internos. O código somava os dois, e o banco ficou com
// ["316102076","PRO"] em 2887 de 2930 cards.
const COORDENACAO_MULTIPLA: CampoDoCard = {
	field: { label: "Coordenação" },
	value: '["PRO", "MNP", "QAB"]',
	array_value: ["316102076", "316102077", "316102080"],
};

const RESPONSAVEL: CampoDoCard = {
	field: { label: "Responsável" },
	value: '["Ana Souza", "Bruno Costa"]',
	array_value: ["100000001", "100000002"],
};

describe("extrairValores", () => {
	it("lê os rótulos e ignora os IDs internos", () => {
		expect(extrairValores(PIPE, [COORDENACAO_MULTIPLA], "coordenacao")).toEqual([
			"PRO",
			"MNP",
			"QAB",
		]);
	});

	it("vale para responsáveis — era daqui que vinham os vendedores fantasma", () => {
		// 61 "vendedores" com nome numérico e 3.398 vínculos apontando para eles.
		expect(extrairValores(PIPE, [RESPONSAVEL], "responsavel")).toEqual([
			"Ana Souza",
			"Bruno Costa",
		]);
	});

	it("aceita valor escalar sem JSON", () => {
		expect(
			extrairValores(
				PIPE,
				[{ field: { label: "Canal de aquisição" }, value: "Busca Paga | google" }],
				"canalAquisicao",
			),
		).toEqual(["Busca Paga | google"]);
	});

	it("cai para array_value só quando não há value", () => {
		// Melhor um ID visível do que um campo que some sem deixar rastro.
		expect(
			extrairValores(
				PIPE,
				[{ field: { label: "Coordenação" }, array_value: ["316102076"] }],
				"coordenacao",
			),
		).toEqual(["316102076"]);
	});

	it("devolve vazio quando o campo não existe no card", () => {
		expect(extrairValores(PIPE, [], "coordenacao")).toEqual([]);
	});
});
