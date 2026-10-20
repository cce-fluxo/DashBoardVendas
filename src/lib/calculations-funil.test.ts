import { describe, it, expect } from "vitest";
import {
	calcularKPIsFunilCompleto,
	calcularComparadorFases,
	calcularComparativoFunilPeriodos,
} from "./calculations-funil";
import type { CardComHistorico, TransicaoFunil } from "./supabase-funil";
import type { EtapaConversao } from "@/types";
import type { EtapaFunil, SelecaoPeriodoFunil } from "@/types";

// ─── Helpers de fabricação de cards ──────────────────────────────

/** Seleção de "gestão inteira" — o recorte que estes testes exercitam. */
const g = (gestao: string): SelecaoPeriodoFunil => ({ gestao, tipo: "gestao" });

let seq = 0;

function hist(...etapas: string[]): TransicaoFunil[] {
	// Timestamps crescentes e arbitrários dentro da gestão 25/26.
	return etapas.map((etapa, i) => ({
		etapa: etapa as TransicaoFunil["etapa"],
		timestamp: `2025-11-0${(i % 9) + 1}T10:00:00.000Z`,
	}));
}

function card(opts: {
	etapaAtual: CardComHistorico["etapa_atual"];
	historico: TransicaoFunil[];
	dataCriacao?: string;
	coordenacoes?: string[];
	valor?: number;
	/** Pipe de origem — define quais etapas foram instrumentadas. */
	pipeId?: string;
}): CardComHistorico {
	seq += 1;
	return {
		id_card: seq,
		pipefy_id: `pipe-${seq}`,
		// 306460930 = "CRM COM", que instrumenta as oito etapas.
		pipe_id: opts.pipeId ?? "306460930",
		nome_card: `Card ${seq}`,
		etapa_atual: opts.etapaAtual,
		coordenacao: "CCE",
		coordenacoes: opts.coordenacoes ?? ["CCE"],
		valor_contrato: opts.valor ?? 0,
		data_criacao: opts.dataCriacao ?? "2025-11-01T10:00:00.000Z",
		historico: opts.historico,
	};
}

function etapaDe(etapas: EtapaConversao[], nome: EtapaFunil) {
	const e = etapas.find((x) => x.etapa === nome);
	if (!e) throw new Error(`etapa ${nome} não encontrada`);
	return e;
}

// Cenário base:
//   A — funil completo até Diagnóstico
//   B — chega em Diagnóstico SEM "Contato aberto"/"Pré-diagnóstico" no histórico
//       (caso que gerava o bug de >100%)
//   C — só até Contato aberto
//   D — fora da janela (gestão 24/25), só conta na QUANTIDADE
function cenarioBase(): CardComHistorico[] {
	return [
		card({
			etapaAtual: "Diagnóstico feito",
			historico: hist(
				"Oportunidade",
				"Contato aberto",
				"Pré-diagnóstico feito",
				"Diagnóstico feito",
			),
		}),
		card({
			etapaAtual: "Diagnóstico feito",
			historico: hist("Oportunidade", "Diagnóstico feito"),
		}),
		card({
			etapaAtual: "Contato aberto",
			historico: hist("Oportunidade", "Contato aberto"),
		}),
		card({
			etapaAtual: "Contato aberto",
			historico: hist("Oportunidade", "Contato aberto"),
			dataCriacao: "2024-05-01T10:00:00.000Z", // gestão anterior
		}),
	];
}

describe("calcularConversao — inferência de fases (C2)", () => {
	it("nunca produz percentual acumulado acima de 100%, mesmo com histórico incompleto", () => {
		const { geral } = calcularKPIsFunilCompleto(cenarioBase(), g("25/26"));
		for (const e of geral.conversao.etapas) {
			expect(e.percentualRelativo ?? 0).toBeLessThanOrEqual(100);
			expect(e.percentualEtapaAnterior ?? 0).toBeLessThanOrEqual(100);
		}
	});

	it("infere fases intermediárias: card que chega em Diagnóstico conta em Contato aberto", () => {
		const { geral } = calcularKPIsFunilCompleto(cenarioBase(), g("25/26"));
		// A, B, C estão na janela e todos alcançaram (ou inferiram) Contato aberto.
		expect(geral.conversao.totalBase).toBe(3);
	});

	it("acumulada e etapa-a-etapa batem com o cenário", () => {
		const { geral } = calcularKPIsFunilCompleto(cenarioBase(), g("25/26"));
		const et = geral.conversao.etapas;

		const contato = etapaDe(et, "Contato aberto");
		expect(contato.percentualRelativo).toBe(100); // 3 de 3 alcançaram
		expect(contato.percentualEtapaAnterior).toBe(100); // vindo de Oportunidade

		const preDiag = etapaDe(et, "Pré-diagnóstico feito");
		expect(preDiag.percentualRelativo).toBeCloseTo(66.67, 1); // 2 de 3
		expect(preDiag.percentualEtapaAnterior).toBeCloseTo(66.67, 1); // 2 de 3

		const diag = etapaDe(et, "Diagnóstico feito");
		expect(diag.percentualRelativo).toBeCloseTo(66.67, 1); // 2 de 3
		expect(diag.percentualEtapaAnterior).toBe(100); // 2 de 2 (Pré-diag → Diag)
	});

	it("Oportunidade é a BASE do funil, não mais pré-funil", () => {
		// Trocou de "Contato aberto" para "Oportunidade": todo card passa por ela,
		// nos dois pipes, o que torna a comparação entre gestões possível.
		const { geral } = calcularKPIsFunilCompleto(cenarioBase(), g("25/26"));
		const op = etapaDe(geral.conversao.etapas, "Oportunidade");
		expect(op.percentualRelativo).toBe(100);
		// É a primeira etapa: não há anterior com que comparar.
		expect(op.percentualEtapaAnterior).toBeUndefined();
	});
});

describe("calcularConversao — quantidade vs percentual", () => {
	// CONTRATO NOVO. Antes a quantidade ignorava data e contava o card D, criado
	// fora da janela, para bater com o board do Pipefy. O efeito era um seletor
	// que mudava os percentuais e não mexia nas quantidades — a mesma tela
	// respondendo a duas perguntas sem dizer qual era qual.
	it("quantidade também respeita o período: card fora da janela não conta", () => {
		const { geral } = calcularKPIsFunilCompleto(cenarioBase(), g("25/26"));
		const et = geral.conversao.etapas;
		// Só C está em Contato aberto DENTRO da janela; D ficou de fora.
		expect(etapaDe(et, "Contato aberto").quantidade).toBe(1);
		// A + B em Diagnóstico, ambos na janela.
		expect(etapaDe(et, "Diagnóstico feito").quantidade).toBe(2);
	});

	// O card D existe e aparece quando o período é o dele. Sem esta asserção, o
	// teste acima passaria mesmo se o filtro estivesse jogando o card fora de vez.
	it("o mesmo card aparece quando o período selecionado é o dele", () => {
		// D foi criado em 01/05/2024 — gestão 23/24 (out/2023 a set/2024).
		const { geral } = calcularKPIsFunilCompleto(cenarioBase(), g("23/24"));
		expect(
			etapaDe(geral.conversao.etapas, "Contato aberto").quantidade,
		).toBe(1);
	});

	it("o percentual NÃO inclui cards fora da janela (base = 3, não 4)", () => {
		const { geral } = calcularKPIsFunilCompleto(cenarioBase(), g("25/26"));
		expect(geral.conversao.totalBase).toBe(3);
	});
});

describe("calcularComparadorFases — mesma inferência (sem >100%)", () => {
	it("Contato aberto → Diagnóstico: 2 de 3", () => {
		const r = calcularComparadorFases(
			cenarioBase(),
			"Contato aberto",
			"Diagnóstico feito",
			g("25/26"),
		);
		expect(r.totalNaEtapaDe).toBe(3);
		expect(r.chegaramNaEtapaPara).toBe(2);
		expect(r.percentual).toBeCloseTo(66.67, 1);
	});

	it("Pré-diagnóstico → Diagnóstico não passa de 100% (caso do bug)", () => {
		const r = calcularComparadorFases(
			cenarioBase(),
			"Pré-diagnóstico feito",
			"Diagnóstico feito",
			g("25/26"),
		);
		// Com inferência: ambos (A e B) alcançaram Pré-diag e Diag → 2/2 = 100%.
		expect(r.percentual).toBeLessThanOrEqual(100);
		expect(r.percentual).toBe(100);
	});

	// A inferência é exatamente o que torna este caso perigoso: um card do pipe
	// antigo que chegou em "Diagnóstico" seria contado como tendo passado por
	// "Contato aberto", fase que nunca existiu lá. A conta sairia — e sairia
	// 100%, o número mais convincente de todos.
	it("recusa medir etapa que o pipe de origem não tinha", () => {
		const cards = [
			card({
				pipeId: "303819426", // CRM Fluxo: sem "Contato aberto"
				etapaAtual: "Diagnóstico feito",
				dataCriacao: "2024-11-01T10:00:00.000Z",
				historico: hist("Oportunidade", "Pré-diagnóstico feito", "Diagnóstico feito"),
			}),
		];

		const r = calcularComparadorFases(
			cards,
			"Contato aberto",
			"Diagnóstico feito",
			g("24/25"),
		);

		expect(r.naoInstrumentadas).toEqual(["Contato aberto"]);
		expect(r.percentual).toBe(0);
		expect(r.totalNaEtapaDe).toBe(0);
	});

	it("etapas instrumentadas nos dois pipes seguem medindo", () => {
		const cards = [
			card({
				pipeId: "303819426",
				etapaAtual: "Diagnóstico feito",
				dataCriacao: "2024-11-01T10:00:00.000Z",
				historico: hist("Oportunidade", "Pré-diagnóstico feito", "Diagnóstico feito"),
			}),
		];

		const r = calcularComparadorFases(
			cards,
			"Oportunidade",
			"Diagnóstico feito",
			g("24/25"),
		);

		expect(r.naoInstrumentadas).toBeUndefined();
		expect(r.percentual).toBe(100);
	});
});

// ─── Comparador periódico de funil (F1) ──────────────────────────

// Transição com timestamp explícito.
function ev(etapa: string, ts: string): TransicaoFunil {
	return { etapa: etapa as TransicaoFunil["etapa"], timestamp: ts };
}

const SEL_NOV: SelecaoPeriodoFunil = { tipo: "mes", gestao: "25/26", mes: "11" };
const SEL_DEZ: SelecaoPeriodoFunil = { tipo: "mes", gestao: "25/26", mes: "12" };

function qtd(p: { conversao: { etapas: { etapa: EtapaFunil; quantidade: number }[] } }, nome: EtapaFunil) {
	return p.conversao.etapas.find((e) => e.etapa === nome)!.quantidade;
}

describe("calcularComparativoFunilPeriodos — coorte por janela de criação", () => {
	// Card de novembro que só avança para Diagnóstico em DEZEMBRO.
	const cardNovLento = card({
		etapaAtual: "Diagnóstico feito",
		dataCriacao: "2025-11-05T10:00:00.000Z",
		historico: [
			ev("Oportunidade", "2025-11-05T10:00:00.000Z"),
			ev("Contato aberto", "2025-11-06T10:00:00.000Z"),
			ev("Diagnóstico feito", "2025-12-10T10:00:00.000Z"),
		],
	});
	// Card de dezembro que fecha em Venda dentro do mês.
	const cardDez = card({
		etapaAtual: "Venda",
		dataCriacao: "2025-12-03T10:00:00.000Z",
		historico: [
			ev("Oportunidade", "2025-12-03T10:00:00.000Z"),
			ev("Contato aberto", "2025-12-04T10:00:00.000Z"),
			ev("Venda", "2025-12-08T10:00:00.000Z"),
		],
	});
	const cards = [cardNovLento, cardDez];
	const agora = new Date("2026-02-01T12:00:00.000Z"); // ambos os meses já fechados

	it("conta no volume só os cards criados na janela de cada período", () => {
		const c = calcularComparativoFunilPeriodos(cards, SEL_NOV, SEL_DEZ, {
			equalizar: false,
			agora,
		});
		expect(c.a.volume.criados).toBe(1); // só o card de nov
		expect(c.b.volume.criados).toBe(1); // só o card de dez
		expect(c.b.volume.chegaramVenda).toBe(1);
		expect(c.a.volume.chegaramVenda).toBe(0);
		expect(c.deltaVolume.chegaramVenda).toBe(1); // b − a
	});

	it("sem equalização (histórico completo), o card de nov chega a Diagnóstico", () => {
		const c = calcularComparativoFunilPeriodos(cards, SEL_NOV, SEL_DEZ, {
			equalizar: false,
			agora,
		});
		expect(c.equalizado).toBe(false);
		expect(c.janelaEqualizada).toBeNull();
		expect(qtd(c.a, "Diagnóstico feito")).toBe(1);
	});

	it("ambos finalizados → janela completa (período inteiro de cada lado)", () => {
		const c = calcularComparativoFunilPeriodos(cards, SEL_NOV, SEL_DEZ, {
			agora, // equalizar = true por padrão; fev/2026 → nov e dez finalizados
		});
		expect(c.equalizado).toBe(true);
		expect(c.janelaEqualizada).toEqual({
			modo: "completo",
			valor: 0,
			unidade: "dias",
		});
		// Funil inteiro da safra: o avanço de 10/dez conta para a coorte de nov.
		expect(qtd(c.a, "Diagnóstico feito")).toBe(1);
	});

	it("com período em andamento, congela o histórico no corte (parcial)", () => {
		// 20/dez: nov finalizado, dez em andamento → modo parcial.
		const agoraDez = new Date("2025-12-20T12:00:00.000Z");
		const c = calcularComparativoFunilPeriodos(cards, SEL_NOV, SEL_DEZ, {
			agora: agoraDez,
		});
		expect(c.janelaEqualizada?.modo).toBe("parcial");
		// Corte de nov = 01/nov + 20 dias = 21/nov; Diagnóstico em 10/dez fica fora.
		expect(qtd(c.a, "Diagnóstico feito")).toBe(0);
		expect(qtd(c.a, "Contato aberto")).toBe(1);
	});
});

describe("calcularComparativoFunilPeriodos — maturidade e janela equalizada", () => {
	const cards = [
		card({
			etapaAtual: "Contato aberto",
			dataCriacao: "2025-11-10T10:00:00.000Z",
			historico: [
				ev("Oportunidade", "2025-11-10T10:00:00.000Z"),
				ev("Contato aberto", "2025-11-11T10:00:00.000Z"),
			],
		}),
		card({
			etapaAtual: "Contato aberto",
			dataCriacao: "2025-12-05T10:00:00.000Z",
			historico: [
				ev("Oportunidade", "2025-12-05T10:00:00.000Z"),
				ev("Contato aberto", "2025-12-06T10:00:00.000Z"),
			],
		}),
	];
	// "Hoje" no meio de dezembro: nov fechado (há ~15d), dez em andamento.
	const agora = new Date("2025-12-15T12:00:00.000Z");

	it("sinaliza nov como 'em maturação' e dez como 'em andamento'", () => {
		const c = calcularComparativoFunilPeriodos(cards, SEL_NOV, SEL_DEZ, { agora });
		expect(c.a.maturidade.emAndamento).toBe(false);
		expect(c.a.maturidade.emMaturacao).toBe(true);
		expect(c.b.maturidade.emAndamento).toBe(true);
		expect(c.b.maturidade.emMaturacao).toBe(false);
	});

	it("ancora a janela nos dias decorridos do período em andamento (dez)", () => {
		const c = calcularComparativoFunilPeriodos(cards, SEL_NOV, SEL_DEZ, { agora });
		expect(c.equalizado).toBe(true);
		// 01/dez 00:00 BRT (03:00Z) → 15/dez = 14 dias inteiros + 1 (dia corrente) = 15.
		expect(c.janelaEqualizada).toEqual({
			modo: "parcial",
			valor: 15,
			unidade: "dias",
		});
	});
});

describe("calcularComparativoFunilPeriodos — equalização por meses (ciclo)", () => {
	const SEL_Q1: SelecaoPeriodoFunil = { tipo: "ciclo", gestao: "25/26", ciclo: "fogo" };
	const SEL_Q2: SelecaoPeriodoFunil = { tipo: "ciclo", gestao: "25/26", ciclo: "forja" };

	it("ambos finalizados → 'completo' em meses", () => {
		const c = calcularComparativoFunilPeriodos([], SEL_Q1, SEL_Q2, {
			agora: new Date("2026-05-01T12:00:00.000Z"), // Q1 e Q2 já finalizados
		});
		expect(c.janelaEqualizada).toEqual({
			modo: "completo",
			valor: 0,
			unidade: "meses",
		});
	});

	it("Q2 em andamento → 'parcial' contado em meses", () => {
		// Meio de fevereiro: Q2 (Jan–Mar) em andamento, Q1 (Out–Dez) finalizado.
		const c = calcularComparativoFunilPeriodos([], SEL_Q1, SEL_Q2, {
			agora: new Date("2026-02-15T12:00:00.000Z"),
		});
		// 01/jan → 15/fev = 1 mês inteiro + 1 (mês corrente) = 2.
		expect(c.janelaEqualizada).toEqual({
			modo: "parcial",
			valor: 2,
			unidade: "meses",
		});
	});
});

// ─── Etapa não instrumentada (F6) ─────────────────────────────────

describe("etapa não instrumentada — o pipe antigo não pode fabricar número", () => {
	const PIPE_ANTIGO = "303819426";

	/** Card do pipe antigo que chegou até Diagnóstico. */
	function cardAntigo() {
		return card({
			pipeId: PIPE_ANTIGO,
			etapaAtual: "Diagnóstico feito",
			historico: [
				{ etapa: "Oportunidade", timestamp: "2025-01-05T10:00:00.000Z" },
				{ etapa: "Diagnóstico feito", timestamp: "2025-01-20T10:00:00.000Z" },
			],
			dataCriacao: "2025-01-05T10:00:00.000Z",
		});
	}

	it("marca as etapas ausentes e NÃO lhes dá percentual", () => {
		const { geral } = calcularKPIsFunilCompleto([cardAntigo()], g("24/25"));

		const contato = etapaDe(geral.conversao.etapas, "Contato aberto");
		expect(contato.naoInstrumentada).toBe(true);
		expect(contato.percentualRelativo).toBeUndefined();
		expect(contato.percentualEtapaAnterior).toBeUndefined();

		const prec = etapaDe(
			geral.conversao.etapas,
			"Precificação/Aprovação em andamento",
		);
		expect(prec.naoInstrumentada).toBe(true);
		expect(prec.percentualRelativo).toBeUndefined();
	});

	it("sem isso, a inferência daria 100% numa fase que nunca existiu", () => {
		// `indiceFaseMaisAvancada` infere que chegar a Diagnóstico implica ter
		// passado pelas anteriores. Para "Contato aberto" isso produziria 1 de 1
		// = 100% — plausível e completamente falso, porque a fase não existia no
		// pipe. É por isso que o corte mora no CÁLCULO e não na UI.
		const { geral } = calcularKPIsFunilCompleto([cardAntigo()], g("24/25"));
		const contato = etapaDe(geral.conversao.etapas, "Contato aberto");
		expect(contato.percentualRelativo).not.toBe(100);
	});

	it("a etapa-a-etapa pula o buraco em vez de comparar com fase inexistente", () => {
		const { geral } = calcularKPIsFunilCompleto([cardAntigo()], g("24/25"));
		// Pré-diagnóstico compara com Oportunidade (a instrumentada anterior),
		// não com "Contato aberto", que não existe aqui.
		const preDiag = etapaDe(geral.conversao.etapas, "Pré-diagnóstico feito");
		expect(preDiag.naoInstrumentada).toBeUndefined();
		expect(preDiag.percentualEtapaAnterior).toBe(100); // 1 de 1, vindo de Oportunidade
	});

	it("cards só do pipe atual mantêm as oito etapas instrumentadas", () => {
		const { geral } = calcularKPIsFunilCompleto(cenarioBase(), g("25/26"));
		expect(
			geral.conversao.etapas.every((e) => e.naoInstrumentada === undefined),
		).toBe(true);
	});

	it("a gestão 24/25 é MISTA de verdade e cai na regra conservadora", () => {
		// Os pipes são disjuntos (antigo até 27/06/2025, novo desde 30/06/2025),
		// mas a gestão 24/25 vai de out/2024 a set/2025 — ela ATRAVESSA a virada.
		// Basta um pipe presente não instrumentar a etapa para ela ficar sem
		// percentual: senão o denominador misturaria "não passou" com "não podia
		// passar", produzindo um número que parece medido e não é.
		const cardNovo = card({
			pipeId: "306460930",
			etapaAtual: "Venda",
			historico: [
				{ etapa: "Oportunidade", timestamp: "2025-08-01T10:00:00.000Z" },
				{ etapa: "Contato aberto", timestamp: "2025-08-05T10:00:00.000Z" },
				{ etapa: "Venda", timestamp: "2025-08-20T10:00:00.000Z" },
			],
			dataCriacao: "2025-08-01T10:00:00.000Z",
		});

		const { geral } = calcularKPIsFunilCompleto(
			[cardAntigo(), cardNovo],
			g("24/25"),
		);
		expect(
			etapaDe(geral.conversao.etapas, "Contato aberto").naoInstrumentada,
		).toBe(true);
	});
})

// ─── Etapa não instrumentada no COMPARADOR (F6) ──────────────────
//
// Este bloco existe por um erro de mira: o corte de etapa não instrumentada foi
// aplicado primeiro em `calcularConversao` (funil geral), que roda sempre na
// gestão atual — um pipe só, tudo instrumentado. Ou seja, na única função onde
// não podia fazer diferença. O comparador, a única tela que atravessa gestões,
// ficou de fora e mostrou "Contato aberto: 80,97%" para 23/24.

describe("comparador — etapa que o pipe da época não tinha", () => {
	// Coorte desenhada para que o resultado MUDE conforme o corte é aplicado ou
	// não — com um card só, tudo dá 100% e o teste passaria dos dois jeitos.
	//
	//   4 cards chegam a Oportunidade
	//   3 chegam a Pré-diagnóstico
	//   2 chegam a Diagnóstico
	//   1 chega a Proposta
	//
	// "Contato aberto" e "Precificação" não existem no CRM Fluxo. Por inferência,
	// alcancaram(Contato aberto) = 3 e alcancaram(Precificação) = 1 — sempre
	// IGUAL à etapa seguinte, que é justamente por que a conta dá 100% e por que
	// o 100% não significa nada.
	const antigo = (
		etapaAtual: EtapaFunil,
		etapas: string[],
	): CardComHistorico =>
		card({
			pipeId: "303819426",
			etapaAtual,
			dataCriacao: "2024-11-05T10:00:00.000Z",
			historico: etapas.map((e, i) =>
				ev(e, `2024-11-${String(i + 5).padStart(2, "0")}T10:00:00.000Z`),
			),
		});

	const cardsAntigos = [
		antigo("Oportunidade", ["Oportunidade"]),
		antigo("Pré-diagnóstico feito", ["Oportunidade", "Pré-diagnóstico feito"]),
		antigo("Diagnóstico feito", [
			"Oportunidade",
			"Pré-diagnóstico feito",
			"Diagnóstico feito",
		]),
		antigo("Proposta comercial feita", [
			"Oportunidade",
			"Pré-diagnóstico feito",
			"Diagnóstico feito",
			"Proposta comercial feita",
		]),
	];

	const sel = (gestao: string): SelecaoPeriodoFunil => ({ gestao, tipo: "gestao" });

	const r = calcularComparativoFunilPeriodos(
		cardsAntigos,
		sel("24/25"),
		sel("24/25"),
		{ equalizar: false },
	);
	const etapa = (nome: EtapaFunil) =>
		r.a.conversao.etapas.find((e) => e.etapa === nome)!;

	it("não atribui percentual a fase que não existia", () => {
		expect(etapa("Contato aberto").naoInstrumentada).toBe(true);
		expect(etapa("Contato aberto").percentualRelativo).toBeUndefined();
		expect(etapa("Precificação/Aprovação em andamento").naoInstrumentada).toBe(
			true,
		);
	});

	it("a quantidade da fase ausente também é inferida — não pode ser afirmada", () => {
		expect(etapa("Contato aberto").quantidade).toBe(0);
	});

	// O 100% era o sintoma visível no dado real de 23/24. Comparar com uma fase
	// inferida sempre dá 100%, porque a inferência garante que todo mundo que
	// chegou à fase N "passou" pela N−1.
	it("etapa-a-etapa pula o buraco em vez de dar 100%", () => {
		// Pré-diagnóstico compara com Oportunidade (pulando Contato aberto):
		// 3 de 4 = 75%. Sem o corte seria 3/3 = 100%.
		expect(etapa("Pré-diagnóstico feito").percentualEtapaAnterior).toBe(75);

		// Proposta compara com Diagnóstico (pulando Precificação):
		// 1 de 2 = 50%. Sem o corte seria 1/1 = 100%.
		expect(etapa("Proposta comercial feita").percentualEtapaAnterior).toBe(50);
	});

	it("as etapas instrumentadas seguem medindo normalmente", () => {
		expect(etapa("Diagnóstico feito").naoInstrumentada).toBeUndefined();
		expect(etapa("Diagnóstico feito").quantidade).toBe(2);
		expect(etapa("Pré-diagnóstico feito").percentualRelativo).toBe(75);
	});
});

describe("comparador — delta entre bases diferentes", () => {
	// A: pipe antigo (sem "Contato aberto") → Pré-diagnóstico mede vs Oportunidade
	// B: pipe novo  (com "Contato aberto")  → Pré-diagnóstico mede vs Contato aberto
	//
	// São transições diferentes. Subtrair as duas dá um delta com seta vermelha
	// convincente e significado nenhum.
	const antigo = card({
		pipeId: "303819426",
		etapaAtual: "Pré-diagnóstico feito",
		dataCriacao: "2024-11-05T10:00:00.000Z",
		historico: [
			ev("Oportunidade", "2024-11-05T10:00:00.000Z"),
			ev("Pré-diagnóstico feito", "2024-11-06T10:00:00.000Z"),
		],
	});
	const novo = card({
		pipeId: "306460930",
		etapaAtual: "Pré-diagnóstico feito",
		dataCriacao: "2025-11-05T10:00:00.000Z",
		historico: [
			ev("Oportunidade", "2025-11-05T10:00:00.000Z"),
			ev("Contato aberto", "2025-11-06T10:00:00.000Z"),
			ev("Pré-diagnóstico feito", "2025-11-07T10:00:00.000Z"),
		],
	});

	const sel = (gestao: string): SelecaoPeriodoFunil => ({ gestao, tipo: "gestao" });
	const r = calcularComparativoFunilPeriodos(
		[antigo, novo],
		sel("24/25"),
		sel("25/26"),
		{ equalizar: false },
	);
	const delta = r.deltaEtapas.find((d) => d.etapa === "Pré-diagnóstico feito")!;

	it("cada lado declara contra qual etapa mediu", () => {
		const a = r.a.conversao.etapas.find((e) => e.etapa === "Pré-diagnóstico feito")!;
		const b = r.b.conversao.etapas.find((e) => e.etapa === "Pré-diagnóstico feito")!;
		expect(a.baseEtapaAnterior).toBe("Oportunidade");
		expect(b.baseEtapaAnterior).toBe("Contato aberto");
	});

	it("não emite delta etapa-a-etapa quando as bases divergem", () => {
		expect(delta.deltaPercentualEtapaAnterior).toBeUndefined();
	});

	// O acumulado usa a mesma base (Oportunidade) nos dois lados, então continua
	// comparável — recusar tudo seria jogar fora informação boa.
	it("o delta acumulado (vs topo) continua sendo calculado", () => {
		expect(delta.deltaPercentualRelativo).toBeDefined();
	});
});
