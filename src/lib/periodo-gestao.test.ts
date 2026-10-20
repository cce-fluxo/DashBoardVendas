import { describe, it, expect } from "vitest";
import {
	anoInicioGestao,
	janelaGestao,
	janelaMes,
	janelaCiclo,
	janelaPeriodo,
	diasEntre,
	dentroDaJanela,
	mesesDoCicloDaGestao,
	gestaoAnterior,
	rotuloCiclo,
} from "./periodo-gestao";

describe("anoInicioGestao", () => {
	it("deriva o ano de início a partir do rótulo da gestão", () => {
		expect(anoInicioGestao("25/26")).toBe(2025);
		expect(anoInicioGestao("24/25")).toBe(2024);
	});
});

describe("janelaGestao", () => {
	it("vai de 01/out do ano de início até 30/set do ano seguinte", () => {
		const { inicio, fim } = janelaGestao("25/26");
		// 01/10/2025 00:00 BRT == 03:00 UTC
		expect(inicio.toISOString()).toBe("2025-10-01T03:00:00.000Z");
		// 30/09/2026 23:59:59.999 BRT
		expect(fim.toISOString()).toBe("2026-10-01T02:59:59.999Z");
	});
});

describe("janelaMes", () => {
	it("mapeia meses 10–12 para o 1º ano da gestão", () => {
		const { inicio, fim } = janelaMes("11", "25/26");
		// 01/11/2025 00:00 BRT == 03:00 UTC
		expect(inicio.toISOString()).toBe("2025-11-01T03:00:00.000Z");
		// 30/11/2025 23:59:59.999 BRT == 01/12 02:59 UTC
		expect(fim.toISOString()).toBe("2025-12-01T02:59:59.999Z");
	});

	it("mapeia meses 01–09 para o 2º ano da gestão", () => {
		const { inicio } = janelaMes("03", "25/26");
		expect(inicio.toISOString()).toBe("2026-03-01T03:00:00.000Z");
	});

	it("usa o último dia correto em fevereiro (28 dias em 2026)", () => {
		const { fim } = janelaMes("02", "25/26");
		// 28/02/2026 23:59:59.999 BRT == 01/03 02:59 UTC
		expect(fim.toISOString()).toBe("2026-03-01T02:59:59.999Z");
	});

	it("usa o último dia correto em meses de 31 dias", () => {
		const { fim } = janelaMes("07", "25/26");
		// 31/07/2026 23:59:59.999 BRT
		expect(fim.toISOString()).toBe("2026-08-01T02:59:59.999Z");
	});
});

describe("janelaCiclo", () => {
	it("ciclo 'fogo' vai de 01/out a 31/dez do 1º ano", () => {
		const { inicio, fim } = janelaCiclo("fogo", "25/26");
		expect(inicio.toISOString()).toBe("2025-10-01T03:00:00.000Z");
		expect(fim.toISOString()).toBe("2026-01-01T02:59:59.999Z");
	});

	it("ciclo 'forja' vai de 01/jan a 31/mar do 2º ano", () => {
		const { inicio, fim } = janelaCiclo("forja", "25/26");
		expect(inicio.toISOString()).toBe("2026-01-01T03:00:00.000Z");
		expect(fim.toISOString()).toBe("2026-04-01T02:59:59.999Z");
	});

	it("o último ciclo termina em 30/set, igual ao fim da gestão", () => {
		const { fim } = janelaCiclo("apollo", "25/26");
		expect(fim.toISOString()).toBe(janelaGestao("25/26").fim.toISOString());
	});
});

describe("janelaPeriodo", () => {
	it("resolve gestão, ciclo e mês para a janela correta", () => {
		expect(janelaPeriodo({ tipo: "gestao", gestao: "25/26" }).inicioISO).toBe(
			janelaGestao("25/26").inicioISO,
		);
		expect(
			janelaPeriodo({ tipo: "ciclo", gestao: "25/26", ciclo: "forja" }).inicioISO,
		).toBe(janelaCiclo("forja", "25/26").inicioISO);
		expect(
			janelaPeriodo({ tipo: "mes", gestao: "25/26", mes: "11" }).inicioISO,
		).toBe(janelaMes("11", "25/26").inicioISO);
	});

	it("cai para a gestão inteira quando falta ciclo/mês", () => {
		expect(janelaPeriodo({ tipo: "ciclo", gestao: "24/25" }).inicioISO).toBe(
			janelaGestao("24/25").inicioISO,
		);
		expect(janelaPeriodo({ tipo: "mes", gestao: "24/25" }).inicioISO).toBe(
			janelaGestao("24/25").inicioISO,
		);
	});
});

describe("diasEntre", () => {
	it("conta dias inteiros decorridos", () => {
		expect(
			diasEntre(new Date("2026-07-01T00:00:00Z"), new Date("2026-07-29T00:00:00Z")),
		).toBe(28);
	});

	it("é negativo quando b é anterior a a", () => {
		expect(
			diasEntre(new Date("2026-07-29T00:00:00Z"), new Date("2026-07-01T00:00:00Z")),
		).toBe(-28);
	});
});

describe("dentroDaJanela", () => {
	it("inclui datas dentro da janela da gestão", () => {
		expect(dentroDaJanela("2025-11-15T12:00:00.000Z", "25/26")).toBe(true);
		expect(dentroDaJanela("2026-09-30T12:00:00.000Z", "25/26")).toBe(true);
	});

	it("exclui datas fora da janela", () => {
		// Antes do início da gestão 25/26
		expect(dentroDaJanela("2025-09-30T12:00:00.000Z", "25/26")).toBe(false);
		// Já na gestão seguinte
		expect(dentroDaJanela("2026-10-02T12:00:00.000Z", "25/26")).toBe(false);
	});

	it("trata data ausente ou inválida como fora da janela", () => {
		expect(dentroDaJanela(null, "25/26")).toBe(false);
		expect(dentroDaJanela(undefined, "25/26")).toBe(false);
		expect(dentroDaJanela("não é data", "25/26")).toBe(false);
	});
});

// ─── Ciclos vindos do registry (F2) ───────────────────────────────

describe("ciclos por gestão — o bug que este trabalho corrigiu", () => {
	it("24/25 tem 3 ciclos de 4 meses, não 4 trimestres", () => {
		expect(mesesDoCicloDaGestao("waterloo", "24/25")).toEqual([
			"10", "11", "12", "01",
		]);
		expect(mesesDoCicloDaGestao("stalingrado", "24/25")).toEqual([
			"02", "03", "04", "05",
		]);
		expect(mesesDoCicloDaGestao("normandia", "24/25")).toEqual([
			"06", "07", "08", "09",
		]);
	});

	it("janeiro pertence ao 1º ciclo de 24/25 — era o mês que sumia", () => {
		// O calendário trimestral hardcoded punha janeiro no 2º trimestre.
		const { inicio, fim } = janelaCiclo("waterloo", "24/25");
		expect(inicio.toISOString()).toBe("2024-10-01T03:00:00.000Z");
		expect(fim.toISOString()).toBe("2025-02-01T02:59:59.999Z");
	});

	it("jul/ago/set de 24/25 ficam no 3º ciclo, não num Q4 fantasma", () => {
		const meses = mesesDoCicloDaGestao("normandia", "24/25");
		expect(meses).toContain("07");
		expect(meses).toContain("08");
		expect(meses).toContain("09");
	});

	it("25/26 tem 4 ciclos de 3 meses — estrutura diferente da 24/25", () => {
		expect(mesesDoCicloDaGestao("fogo", "25/26")).toEqual(["10", "11", "12"]);
		expect(mesesDoCicloDaGestao("apollo", "25/26")).toEqual(["07", "08", "09"]);
	});

	it("ciclo de outra gestão lança nomeando os válidos", () => {
		// "waterloo" é de 24/25; pedir na 25/26 é erro de programação.
		expect(() => mesesDoCicloDaGestao("waterloo", "25/26")).toThrow(
			/fogo, forja, era-industrial, apollo/,
		);
	});
});

describe("gestaoAnterior", () => {
	it("é aritmética, não tabela", () => {
		expect(gestaoAnterior("25/26")).toBe("24/25");
		expect(gestaoAnterior("24/25")).toBe("23/24");
	});

	it("funciona numa gestão futura sem editar código", () => {
		expect(gestaoAnterior("31/32")).toBe("30/31");
	});
});

describe("rotuloCiclo", () => {
	it("carrega nome e intervalo — ninguém precisa decorar o calendário", () => {
		expect(rotuloCiclo("waterloo", "24/25")).toBe(
			"Ciclo Waterloo · Out/2024–Jan/2025",
		);
		expect(rotuloCiclo("fogo", "25/26")).toBe(
			"Ciclo Revolução do Fogo · Out/2025–Dez/2025",
		);
	});
});
