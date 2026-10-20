import { describe, expect, it } from "vitest";

import { MetaPeriodo, Venda } from "@/types";
import {
	calcularMetricasCongeladas,
	hashMetricas,
	jsonCanonico,
} from "./metricas";
import { compararComAFonte } from "./ler";
import {
	periodosCongelaveis,
	liberadoAPartirDe,
	MESES_DE_CARENCIA,
} from "./congelar";

function venda(p: Partial<Venda> = {}): Venda {
	return {
		mes: "11",
		projetoAssinado: "Projeto",
		assinado: true,
		coordenacao: "CCE",
		itemDaCarta: "",
		prazo: 0,
		valorContrato: 0,
		valorVendidoReal: 1000,
		valorContratoParcelas: 0,
		precoPorSemana: 0,
		numeroParcelas: 0,
		canalDeAquisicao: "Indicação",
		fidelizacao: false,
		compiladoNoPortal: false,
		gestao: "24/25",
		...p,
	};
}

describe("jsonCanonico", () => {
	it("ordena chaves em qualquer profundidade", () => {
		const a = { b: 1, a: { z: 1, y: 2 } };
		const b = { a: { y: 2, z: 1 }, b: 1 };
		expect(jsonCanonico(a)).toBe(jsonCanonico(b));
	});

	// JSON.stringify preserva ordem de inserção: sem canonicalizar, o mesmo dado
	// montado por dois caminhos geraria hashes diferentes e a auditoria acusaria
	// adulteração onde não houve nenhuma.
	it("difere de JSON.stringify quando a ordem de inserção difere", () => {
		const a = { b: 1, a: 2 };
		const b = { a: 2, b: 1 };
		expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
		expect(jsonCanonico(a)).toBe(jsonCanonico(b));
	});

	it("preserva a ordem de arrays — ali a ordem é informação", () => {
		expect(jsonCanonico([1, 2])).not.toBe(jsonCanonico([2, 1]));
	});
});

describe("calcularMetricasCongeladas", () => {
	const metas: MetaPeriodo[] = [
		{ gestao: "24/25", metaVendas: 5000, coordenacao: null },
	];

	it("conta só venda assinada", () => {
		const m = calcularMetricasCongeladas(
			[venda(), venda({ assinado: false, valorVendidoReal: 9999 })],
			metas,
			{ gestao: "24/25", tipo: "gestao" },
		);
		expect(m.totalVendido).toBe(1000);
		expect(m.numeroDeVendas).toBe(1);
	});

	it("distingue meta ausente de meta zero", () => {
		const semMeta = calcularMetricasCongeladas([venda()], [], {
			gestao: "24/25",
			tipo: "gestao",
		});
		expect(semMeta.metaDefinida).toBe(false);
		expect(semMeta.percentualMeta).toBe(0);

		const comMeta = calcularMetricasCongeladas([venda()], metas, {
			gestao: "24/25",
			tipo: "gestao",
		});
		expect(comMeta.metaDefinida).toBe(true);
		expect(comMeta.percentualMeta).toBe(20);
	});

	// O hash cobre a lista inteira; se a ordem viesse da ordem de chegada das
	// vendas (que depende da paginação do banco), o hash mudaria sozinho.
	it("hash não depende da ordem em que as vendas chegam", () => {
		const vs = [
			venda({ coordenacao: "PRO", canalDeAquisicao: "Zebra" }),
			venda({ coordenacao: "ACE", canalDeAquisicao: "Alfa" }),
			venda({ coordenacao: "CCE", canalDeAquisicao: "Meio" }),
		];
		const sel = { gestao: "24/25", tipo: "gestao" as const };
		const h1 = hashMetricas(calcularMetricasCongeladas(vs, metas, sel));
		const h2 = hashMetricas(
			calcularMetricasCongeladas([...vs].reverse(), metas, sel),
		);
		expect(h1).toBe(h2);
	});

	it("hash muda quando um valor muda", () => {
		const sel = { gestao: "24/25", tipo: "gestao" as const };
		const h1 = hashMetricas(calcularMetricasCongeladas([venda()], metas, sel));
		const h2 = hashMetricas(
			calcularMetricasCongeladas(
				[venda({ valorVendidoReal: 1000.01 })],
				metas,
				sel,
			),
		);
		expect(h1).not.toBe(h2);
	});

	// Soma de ponto flutuante depende da ordem das parcelas. Sem arredondar,
	// 0.1 + 0.2 assombraria o hash.
	it("arredonda dinheiro para não vazar imprecisão de ponto flutuante", () => {
		const m = calcularMetricasCongeladas(
			[venda({ valorVendidoReal: 0.1 }), venda({ valorVendidoReal: 0.2 })],
			[],
			{ gestao: "24/25", tipo: "gestao" },
		);
		expect(m.totalVendido).toBe(0.3);
	});
});

describe("liberadoAPartirDe", () => {
	const brt = (iso: string) => new Date(`${iso}-03:00`);

	// A regra é de CALENDÁRIO, não de dias corridos. Janeiro mais 30 dias cairia
	// em 2 de março — dois dias depois de fevereiro ter acabado — e a fronteira
	// passaria a depender do tamanho do mês.
	it("libera no último instante do mês seguinte ao fim", () => {
		expect(liberadoAPartirDe(brt("2026-01-31T23:59:59.999")).toISOString()).toBe(
			brt("2026-02-28T23:59:59.999").toISOString(),
		);
		expect(liberadoAPartirDe(brt("2026-06-30T23:59:59.999")).toISOString()).toBe(
			brt("2026-07-31T23:59:59.999").toISOString(),
		);
	});

	it("vira o ano", () => {
		expect(liberadoAPartirDe(brt("2025-12-31T23:59:59.999")).toISOString()).toBe(
			brt("2026-01-31T23:59:59.999").toISOString(),
		);
	});

	// 30/06 23:59:59.999 BRT é 01/07 02:59 UTC. Ler o mês em UTC devolveria
	// julho e a carência sairia um mês curta.
	it("lê o mês em Brasília, não em UTC", () => {
		const fimDeJunho = brt("2026-06-30T23:59:59.999");
		expect(fimDeJunho.getUTCMonth() + 1).toBe(7); // é julho em UTC
		expect(liberadoAPartirDe(fimDeJunho).toISOString()).toBe(
			brt("2026-07-31T23:59:59.999").toISOString(),
		);
	});

	it("MESES_DE_CARENCIA está em 1 — a regra que a tela promete", () => {
		expect(MESES_DE_CARENCIA).toBe(1);
	});
});

describe("periodosCongelaveis", () => {
	// Gestão 23/24 termina em 30/09/2024.
	const depois = new Date("2026-08-19T12:00:00-03:00");

	it("inclui gestão encerrada há muito tempo", () => {
		const ps = periodosCongelaveis(depois);
		expect(ps.some((p) => p.sel.gestao === "23/24" && p.sel.tipo === "gestao")).toBe(
			true,
		);
	});

	it("não inclui a gestão em curso", () => {
		const ps = periodosCongelaveis(depois);
		expect(ps.some((p) => p.sel.gestao === "25/26" && p.sel.tipo === "gestao")).toBe(
			false,
		);
	});

	// A carência existe para o lançamento atrasado de contrato: um período que
	// acabou ontem ainda vai receber lançamento.
	it("respeita a carência: nenhum período liberado antes da hora", () => {
		for (const p of periodosCongelaveis(depois)) {
			expect(liberadoAPartirDe(p.fim).getTime()).toBeLessThanOrEqual(
				depois.getTime(),
			);
		}
	});

	it("congela mês fechado mesmo com a gestão ainda em curso", () => {
		const ps = periodosCongelaveis(depois);
		const mesesDe2526 = ps.filter(
			(p) => p.sel.gestao === "25/26" && p.sel.tipo === "mes",
		);
		expect(mesesDe2526.length).toBeGreaterThan(0);
	});
});

// ─── Deriva entre o congelado e a fonte ──────────────────────────

describe("compararComAFonte", () => {
	const sel = { gestao: "24/25", tipo: "gestao" as const };
	const original = [venda({ valorVendidoReal: 1000 })];
	const metas: MetaPeriodo[] = [
		{ gestao: "24/25", metaVendas: 5000, coordenacao: null },
	];

	const snap = (m = calcularMetricasCongeladas(original, metas, sel)) => ({
		idSnapshot: 1,
		gestao: "24/25",
		tipoPeriodo: "gestao" as const,
		periodo: "24/25",
		metricas: m,
		hashMetricas: hashMetricas(m),
		versaoCalculo: 1,
		geradoEm: "2026-08-27T00:00:00Z",
	});

	it("fonte intacta não gera deriva", () => {
		const d = compararComAFonte(snap(), 1, original, metas);
		expect(d!.hashConfere).toBe(true);
		expect(d!.diferencas).toEqual([]);
	});

	// O caso que a F7 existe para pegar: alguém corrige a planilha de um período
	// já fechado. O congelado NÃO muda — e é justamente por isso que a mudança
	// precisa ser anunciada, senão a tela passa a discordar da fonte em silêncio.
	it("acusa quando a fonte muda depois do congelamento", () => {
		const s = snap();
		const alterada = [venda({ valorVendidoReal: 1500 })];
		const d = compararComAFonte(s, 1, alterada, metas);

		expect(s.metricas.totalVendido).toBe(1000); // o congelado não se move
		expect(d!.diferencas.some((x) => x.campo === "totalVendido")).toBe(true);
		const dif = d!.diferencas.find((x) => x.campo === "totalVendido")!;
		expect(dif.congelado).toBe(1000);
		expect(dif.agora).toBe(1500);
	});

	// Hash que não bate é de OUTRA natureza: o banco recusa UPDATE nesta tabela,
	// então significa alteração feita por fora. Não confundir com deriva da fonte.
	it("acusa adulteração do próprio JSON guardado", () => {
		const s = snap();
		const mexido = { ...s, metricas: { ...s.metricas, totalVendido: 99999 } };
		const d = compararComAFonte(mexido, 1, original, metas);
		expect(d!.hashConfere).toBe(false);
	});

	// Entre versões diferentes a divergência é ESPERADA — mudou a regra. Comparar
	// produziria alarme em toda tela após qualquer mudança de cálculo.
	it("não compara snapshot de outra versão de cálculo", () => {
		expect(compararComAFonte({ ...snap(), versaoCalculo: 0 }, 1, original, metas)).
			toBeNull();
	});
});
