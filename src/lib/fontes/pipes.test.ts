import { describe, expect, it } from "vitest";

import {
	ETAPAS_CANONICAS,
	buscarPipe,
	campoCasa,
	faseIgnorada,
	normalizarLabel,
	pipesDoCron,
	resolverFase,
	todosOsPipes,
} from "./pipes";

const ANTIGO = buscarPipe("303819426");
const ATUAL = buscarPipe("306460930");

describe("normalizarLabel", () => {
	it("remove emoji — o caso que apagaria o canal de 1608 cards", () => {
		// O pipe antigo chama o campo de "🗣️ Canal de aquisição". Com a
		// normalização antiga (só toLowerCase().trim()) ele nunca casaria.
		expect(normalizarLabel("🗣️ Canal de aquisição")).toBe(
			normalizarLabel("Canal de aquisição"),
		);
	});

	it("continua ignorando acento e caixa", () => {
		expect(normalizarLabel("VALOR DA PROPOSTA")).toBe(
			normalizarLabel("Valor da Proposta"),
		);
	});

	it("não confunde campos diferentes", () => {
		expect(normalizarLabel("Responsável")).not.toBe(
			normalizarLabel("Vendedor Responsável"),
		);
	});
});

describe("resolverFase", () => {
	it("traduz as fases numeradas do pipe atual", () => {
		expect(resolverFase(ATUAL, "1. Oportunidade")).toEqual({
			canonica: "Oportunidade",
			terminal: false,
		});
		expect(resolverFase(ATUAL, "5. Precificação/Aprovação em andamento")).toEqual(
			{ canonica: "Precificação/Aprovação em andamento", terminal: false },
		);
	});

	it("traduz as fases sem numeração do pipe antigo", () => {
		expect(resolverFase(ANTIGO, "Pré Diagnóstico Feito")).toEqual({
			canonica: "Pré-diagnóstico feito",
			terminal: false,
		});
		expect(resolverFase(ANTIGO, "Follow Up")).toEqual({
			canonica: "Follow-up",
			terminal: false,
		});
	});

	it("resolve 'Pausados' no plural do pipe antigo", () => {
		expect(resolverFase(ANTIGO, "Pausados")).toEqual({
			canonica: "Pausado",
			terminal: true,
		});
		expect(resolverFase(ATUAL, "Pausado")).toEqual({
			canonica: "Pausado",
			terminal: true,
		});
	});

	it("fase de um pipe NÃO resolve no outro", () => {
		// "1. Oportunidade" só existe no atual; "Pausados" só no antigo.
		expect(resolverFase(ANTIGO, "1. Oportunidade")).toBeNull();
		expect(resolverFase(ATUAL, "Pausados")).toBeNull();
	});

	it("fase desconhecida devolve null — vira rejeição, não descarte calado", () => {
		expect(resolverFase(ATUAL, "8. Fase Nova Que Alguém Criou")).toBeNull();
	});
});

describe("etapas não instrumentadas", () => {
	it("o pipe antigo não tem 'Contato aberto' nem Precificação", () => {
		expect(ANTIGO.etapasNaoInstrumentadas).toEqual([
			"Contato aberto",
			"Precificação/Aprovação em andamento",
		]);
	});

	it("o pipe atual instrumenta as oito etapas", () => {
		expect(ATUAL.etapasNaoInstrumentadas).toEqual([]);
		const cobertas = new Set(Object.values(ATUAL.fasesComerciais));
		for (const e of ETAPAS_CANONICAS) expect(cobertas.has(e)).toBe(true);
	});

	it("toda etapa canônica do pipe antigo ou está mapeada, ou está declarada ausente", () => {
		// Sem esta invariante, esquecer de declarar uma ausência faria a etapa
		// parecer ter conversão zero em vez de não ter sido medida.
		const cobertas = new Set(Object.values(ANTIGO.fasesComerciais));
		for (const e of ETAPAS_CANONICAS) {
			const mapeada = cobertas.has(e);
			const ausente = ANTIGO.etapasNaoInstrumentadas.includes(e);
			expect(mapeada !== ausente, `etapa "${e}"`).toBe(true);
		}
	});
});

describe("campoCasa", () => {
	it("casa o campo com emoji do pipe antigo", () => {
		expect(campoCasa(ANTIGO, "canalAquisicao", "🗣️ Canal de aquisição")).toBe(
			true,
		);
		// E casaria mesmo se alguém tirasse o emoji da planilha.
		expect(campoCasa(ANTIGO, "canalAquisicao", "Canal de aquisição")).toBe(true);
	});

	it("o responsável tem nome diferente em cada pipe", () => {
		expect(campoCasa(ANTIGO, "responsavel", "Vendedor Responsável")).toBe(true);
		expect(campoCasa(ANTIGO, "responsavel", "Responsável")).toBe(false);
		expect(campoCasa(ATUAL, "responsavel", "Responsável")).toBe(true);
	});
});

describe("escopo do cron", () => {
	it("o cron ignora o pipe encerrado", () => {
		expect(pipesDoCron().map((p) => p.pipeId)).toEqual(["306460930"]);
	});

	it("o backfill vê os dois", () => {
		expect(todosOsPipes()).toHaveLength(2);
	});

	it("pipe desconhecido lança nomeando os conhecidos", () => {
		expect(() => buscarPipe("999")).toThrow(/CRM COM/);
	});
});

describe("faseIgnorada", () => {
	it("'Start form' fica fora do funil no pipe atual", () => {
		expect(faseIgnorada(ATUAL, "Start form")).toBe(true);
		expect(faseIgnorada(ATUAL, "Venda")).toBe(false);
	});

	// A primeira carga do pipe antigo rejeitou os 1608 cards, um por um, porque
	// aqui estava `fasesIgnoradas: []`. "Start form" não aparece em
	// `pipe { phases }` — aparece no `phases_history` de todo card — e a inspeção
	// olhou só a lista de fases. O teste acima existia e passava: cobria só o
	// pipe atual. Por isso este roda sobre TODOS os pipes.
	it.each(todosOsPipes())(
		"'Start form' fica fora do funil em $nome",
		(pipe) => {
			expect(faseIgnorada(pipe, "Start form")).toBe(true);
			expect(resolverFase(pipe, "Start form")).toBeNull();
		},
	);
});
