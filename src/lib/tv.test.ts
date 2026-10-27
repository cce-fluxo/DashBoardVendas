import { describe, expect, it } from "vitest";

import type { Venda } from "@/types";
import type { CardComHistorico } from "./supabase-funil";
import type { ProjetoEntrega } from "./supabase-vendas";
import { cicloVigente, montarTv } from "./tv";

// 26/10/2026, meio-dia em Brasília: gestão 26/27, ciclo Gambito (out–dez).
const HOJE = new Date("2026-10-26T15:00:00.000Z");

function venda(p: Partial<Venda> = {}): Venda {
	return {
		mes: "10",
		projetoAssinado: "Projeto",
		assinado: true,
		coordenacao: "CCE",
		itemDaCarta: "",
		prazo: 0,
		valorContrato: 1000,
		valorVendidoReal: 1000,
		valorContratoParcelas: 0,
		precoPorSemana: 0,
		numeroParcelas: 0,
		canalDeAquisicao: "",
		fidelizacao: false,
		compiladoNoPortal: false,
		gestao: "26/27",
		...p,
	};
}

let seq = 0;
function card(etapas: string[], criado: string): CardComHistorico {
	seq += 1;
	return {
		id_card: seq,
		pipefy_id: `p${seq}`,
		pipe_id: "306460930",
		nome_card: `Card ${seq}`,
		etapa_atual: etapas[etapas.length - 1] as CardComHistorico["etapa_atual"],
		coordenacao: "CCE",
		coordenacoes: ["CCE"],
		valor_contrato: 0,
		data_criacao: criado,
		historico: etapas.map((etapa, i) => ({
			etapa: etapa as CardComHistorico["etapa_atual"],
			timestamp: new Date(new Date(criado).getTime() + i * 86_400_000).toISOString(),
		})),
	};
}

describe("cicloVigente", () => {
	it("acha o ciclo que contém a data", () => {
		expect(cicloVigente("26/27", HOJE)).toBe("gambito");
		expect(cicloVigente("25/26", new Date("2026-08-10T12:00:00Z"))).toBe("apollo");
	});
});

describe("montarTv · ranking", () => {
	const vendas = [
		venda({ responsavel1: "Ana", responsavel2: "Bruno", valorContrato: 300, valorVendidoReal: 300 }),
		venda({ responsavel1: "Ana", valorContrato: 100, valorVendidoReal: 100 }),
		venda({ gestao: "25/26", mes: "05", responsavel1: "Ana", valorContrato: 50, valorVendidoReal: 50 }),
	];
	const tv = montarTv(vendas, [], HOJE);

	it("o total da gestão é o vendido, não a soma do ranking", () => {
		// Ana 400 + Bruno 300 = 700 no ranking; vendido de fato = 400.
		expect(tv.rankingGestao.totalVendido).toBe(400);
		expect(tv.rankingGestao.vendedores.map((v) => [v.nome, v.vendido])).toEqual([
			["Ana", 400],
			["Bruno", 300],
		]);
	});

	it("o histórico soma a pessoa em todas as gestões", () => {
		expect(tv.rankingHistorico.vendedores[0]).toMatchObject({ nome: "Ana", vendido: 450, contratos: 3 });
		expect(tv.rankingHistorico.rotulo).toMatch(/^histórico 23\/24–26\/27$/);
	});

	it("até 23/24 o responsável leva o vendido real, não o valor do contrato", () => {
		const antiga = venda({ gestao: "23/24", mes: "05", responsavel1: "Zé", valorContrato: 41456, valorVendidoReal: 3750 });
		const r = montarTv([antiga], [], HOJE).rankingHistorico;
		expect(r.vendedores[0]).toMatchObject({ nome: "Zé", vendido: 3750 });
	});

	it("foto vem pelo nome de exibição; sem foto, null", () => {
		const comFoto = montarTv(vendas, [], HOJE, new Map([["Ana", "https://x/ana.jpg"]]));
		expect(comFoto.rankingGestao.vendedores.map((v) => v.foto)).toEqual(["https://x/ana.jpg", null]);
	});

	it("funil sem card sai do ciclo de telas", () => {
		expect(tv.telas).toEqual(["ranking-gestao", "ranking-historico", "fechados"]);
	});
});

describe("montarTv · últimos fechados", () => {
	it("ordena por data de assinatura e cai no mês quando falta", () => {
		const tv = montarTv(
			[
				venda({ projetoAssinado: "A", dataAssinatura: "2026-10-05" }),
				venda({ projetoAssinado: "B", dataAssinatura: "2026-10-20", contratante: "Sanson" }),
				venda({ projetoAssinado: "C", mes: "11" }),
				venda({ projetoAssinado: "D", responsavel1: "Ana", responsavel2: "Bruno", dataAssinatura: "2026-10-12" }),
				venda({ projetoAssinado: "E", dataAssinatura: "2026-10-01" }),
			],
			[],
			HOJE,
		);
		expect(tv.fechados.fechados.map((f) => f.projeto)).toEqual(["C", "B", "D", "A"]);
		expect(tv.fechados.fechados[0]).toMatchObject({ data: "2026-11-01", dataExata: false, diasAtras: null });
		expect(tv.fechados.fechados[1]).toMatchObject({ cliente: "Sanson", diasAtras: 6 });
		expect(tv.fechados.fechados[2].responsaveis.map((p) => p.nome)).toEqual(["Ana", "Bruno"]);
		expect(tv.fechados.totalGestao).toBe(5);
	});

	it("compara com a gestão anterior no mesmo dia, só com data de assinatura", () => {
		const anteriores = [
			venda({ gestao: "25/26", dataAssinatura: "2025-10-10" }),
			venda({ gestao: "25/26", dataAssinatura: "2025-10-25" }),
			venda({ gestao: "25/26", dataAssinatura: "2025-11-02" }),
		];
		expect(montarTv(anteriores, [], HOJE).fechados.anteriorMesmoPonto).toBe(2);

		const semData = [...anteriores, venda({ gestao: "25/26", mes: "12" })];
		expect(montarTv(semData, [], HOJE).fechados.anteriorMesmoPonto).toBeNull();
	});
});

describe("montarTv · funil", () => {
	it("mapeia as quatro caixas sobre a safra do ciclo", () => {
		const em = "2026-10-03T12:00:00.000Z";
		const cards = [
			card(["Oportunidade"], em),
			card(["Oportunidade", "Contato aberto", "Pré-diagnóstico feito"], em),
			card(
				[
					"Oportunidade",
					"Contato aberto",
					"Pré-diagnóstico feito",
					"Diagnóstico feito",
					"Precificação/Aprovação em andamento",
					"Proposta comercial feita",
					"Follow-up",
					"Venda",
				],
				em,
			),
			// Safra de outro ciclo: não entra.
			card(["Oportunidade"], "2026-08-03T12:00:00.000Z"),
		];
		const { funil, telas } = montarTv([], cards, HOJE);
		expect(funil.ciclo).toBe("Ciclo Gambito");
		expect(funil.etapas.map((e) => e.quantidade)).toEqual([3, 2, 1, 1]);
		expect(funil.conversaoTotal).toBeCloseTo(1 / 3);
		expect(telas).toContain("funil");
	});
});

describe("metas", () => {
	const fontes = {
		metas: [
			{ gestao: "26/27" as const, ciclo: "gambito", metaVendas: 335_000, coordenacao: null },
			{ gestao: "26/27" as const, mes: "10", metaVendas: 110_000, coordenacao: null },
		],
		metasFaturamento: [{ gestao: "26/27" as const, mes: "10", metaVendas: 125_000, coordenacao: null }],
		faturamento: [
			{ gestao: "26/27", coordenacao: null, mes: "2026-10-01", previsto: 166_000, realizado: 88_000 },
			{ gestao: "26/27", coordenacao: null, mes: "2026-11-01", previsto: 72_000, realizado: 0 },
			{ gestao: "26/27", coordenacao: "ACE", mes: "2026-10-01", previsto: 1, realizado: 1 },
		],
	};
	const tv = montarTv([venda({ valorVendidoReal: 40_000 })], [], HOJE, new Map(), fontes);

	it("meses do ciclo com vendido, metas e faturamento da Fluxo", () => {
		expect(tv.telas[0]).toBe("metas");
		expect(tv.metas.meses.map((m) => m.abrev)).toEqual(["out", "nov", "dez"]);
		expect(tv.metas.meses[0]).toMatchObject({
			vendido: 40_000, metaVendas: 110_000, faturado: 88_000, previsto: 166_000, metaFaturamento: 125_000,
		});
		// Sem meta na planilha é null, não zero.
		expect(tv.metas.meses[1].metaVendas).toBeNull();
		expect(tv.metas.mesAtual).toBe(0);
	});

	it("gráfico não mostra realizado de mês futuro", () => {
		expect(tv.metas.grafico[0].realizado).toBe(88_000);
		expect(tv.metas.grafico[1]).toMatchObject({ realizado: null, previsto: 72_000 });
	});

	it("sem faturamento a tela sai do ciclo", () => {
		expect(montarTv([venda()], [], HOJE).telas).not.toContain("metas");
	});
});

describe("entregas", () => {
	const p = (x: Partial<ProjetoEntrega>): ProjetoEntrega => ({
		estado: "entregue", coordenacao: "CCE", nome_projeto: "P", gestao_venda: "25/26",
		gestao_entrega: "25/26", data_entrega: null, tamanho_equipe: 3, equipe: [], situacao: "Finalizado", ...x,
	});
	const vazio = { metas: [], metasFaturamento: [], faturamento: [] };
	const tv = montarTv([venda()], [], HOJE, new Map(), {
		...vazio,
		entregas: [
			p({ nome_projeto: "Antiga", gestao_entrega: "24/25", data_entrega: "2025-05-01" }),
			p({ nome_projeto: "Sem data" }),
			p({ nome_projeto: "Recente", data_entrega: "2026-08-31" }),
			p({ nome_projeto: "Futura", data_entrega: "2026-12-15" }),
			p({ nome_projeto: "Rescindida", data_entrega: "2026-09-10", situacao: "Rescindido" }),
			// "Gestão - Entrega" diz 25/26, a data diz 26/27: vale a data.
			p({ nome_projeto: "Nesta gestão", gestao_entrega: "25/26", data_entrega: "2026-10-20" }),
			p({ estado: "em_execucao", nome_projeto: "Rodando", gestao_entrega: null }),
		],
	});

	it("mais recentes primeiro, gestão pela data; sem data ou no futuro fica fora", () => {
		expect(tv.entregas.entregas.map((e) => [e.projeto, e.gestao])).toEqual([
			["Nesta gestão", "26/27"],
			["Recente", "25/26"],
			["Antiga", "24/25"],
		]);
		expect(tv.entregas.entregas[0]).toMatchObject({ gestao: "26/27", diasAtras: 6 });
	});

	it("rescindido não conta; em execução conta à parte", () => {
		expect(tv.entregas).toMatchObject({ totalGestao: 1, totalAnterior: 1, noCiclo: 1, emExecucao: 1 });
		expect(tv.telas).toContain("entregas");
	});
});

describe("equipe das entregas", () => {
	it("resolve para a pessoa (nome curto e foto); fora da base, primeiro e último nome", () => {
		const tv = montarTv([venda()], [], HOJE, new Map([["Gabriel Pereira", "http://foto"]]), {
			metas: [],
			metasFaturamento: [],
			faturamento: [],
			entregas: [{
				estado: "entregue", coordenacao: "CCE", nome_projeto: "App", gestao_venda: "25/26",
				gestao_entrega: null, data_entrega: "2026-10-20", tamanho_equipe: 2, situacao: null,
				equipe: ["Gabriel Santos Pereira", "Fabricio Natil Martins Moreira"],
			}],
			resolver: (n) => (n === "Gabriel Santos Pereira" ? "Gabriel Pereira" : n),
		});
		expect(tv.entregas.entregas[0].pessoas).toEqual([
			{ nome: "Gabriel Pereira", iniciais: "GP", foto: "http://foto" },
			{ nome: "Fabricio Moreira", iniciais: "FM", foto: null },
		]);
	});
});
