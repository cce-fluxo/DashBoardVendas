import { describe, expect, it } from "vitest";

import { COBERTURAS, avisoDeLacunaFunil, lacunasDeFunil } from "./cobertura";
import { PIPES } from "./pipes";
import { GESTOES } from "./registry";

const BRT = "-03:00";
const d = (iso: string) => new Date(`${iso}${BRT}`);

describe("declaração de cobertura", () => {
	it("todo pipe do registry declara sua cobertura", () => {
		for (const p of PIPES) {
			const c = COBERTURAS.find(
				(x) => x.fonteTipo === "pipefy" && x.fonteRef === p.pipeId,
			);
			expect(c, `pipe ${p.nome} sem cobertura declarada`).toBeDefined();
		}
	});

	it("toda gestão do registry declara a cobertura da sua planilha", () => {
		for (const g of GESTOES) {
			const c = COBERTURAS.find(
				(x) => x.fonteTipo === "planilha" && x.gestao === g.id,
			);
			expect(c, `gestão ${g.id} sem cobertura declarada`).toBeDefined();
		}
	});

	it("só o pipe em uso fica sem fim declarado", () => {
		const abertas = COBERTURAS.filter(
			(c) => c.fonteTipo === "pipefy" && c.fimISO === null,
		);
		expect(abertas).toHaveLength(1);
		expect(abertas[0].fonteRef).toBe("306460930");
	});
});

describe("lacunasDeFunil", () => {
	// O caso que motivou a tabela inteira. O 1º ciclo de 23/24 vai de outubro a
	// janeiro; o Pipefy antigo só começa em 18/12/2023. Comparar esse ciclo com o
	// de 24/25 sem dizer isso mostra "o funil encolheu" — e o funil não encolheu,
	// ele não existia.
	it("acusa o buraco antes do primeiro Pipefy", () => {
		const l = lacunasDeFunil(d("2023-10-01T00:00:00"), d("2024-01-31T23:59:59"));
		expect(l).toHaveLength(1);
		expect(l[0].inicio.getTime()).toBe(d("2023-10-01T00:00:00").getTime());
		expect(l[0].fim.getTime()).toBe(d("2023-12-18T00:00:00").getTime());
		expect(l[0].dias).toBe(78);
	});

	it("gestão 23/24 inteira: só o trecho inicial falta", () => {
		const l = lacunasDeFunil(d("2023-10-01T00:00:00"), d("2024-09-30T23:59:59"));
		expect(l).toHaveLength(1);
		expect(l[0].dias).toBe(78);
	});

	it("gestão 24/25 é inteiramente coberta", () => {
		expect(
			lacunasDeFunil(d("2024-10-01T00:00:00"), d("2025-09-30T23:59:59")),
		).toEqual([]);
	});

	it("gestão 25/26 é inteiramente coberta — o pipe atual não tem fim", () => {
		expect(
			lacunasDeFunil(d("2025-10-01T00:00:00"), d("2026-09-30T23:59:59")),
		).toEqual([]);
	});

	// A troca de CRM: último card do pipe antigo em 27/06/2025, primeiro do novo
	// em 30/06. A cobertura do antigo vai até 29/06 de propósito — 28 e 29 são
	// dias sem venda com o CRM no ar, não dias sem medição.
	it("a emenda entre os dois pipes não vira lacuna", () => {
		expect(
			lacunasDeFunil(d("2025-06-01T00:00:00"), d("2025-07-31T23:59:59")),
		).toEqual([]);
	});
});

describe("avisoDeLacunaFunil", () => {
	it("período coberto não gera aviso — ruído mata aviso", () => {
		expect(
			avisoDeLacunaFunil(d("2024-10-01T00:00:00"), d("2025-09-30T23:59:59")),
		).toBeNull();
	});

	it("diz quanto do período ficou de fora, não só que ficou", () => {
		const a = avisoDeLacunaFunil(
			d("2023-10-01T00:00:00"),
			d("2024-01-31T23:59:59"),
		);
		expect(a).not.toBeNull();
		expect(a!.diasSemFunil).toBe(78);
		expect(a!.texto).toContain("01/10/2023");
		expect(a!.texto).toContain("18/12/2023");
		expect(a!.texto).toMatch(/6[0-9]%|\d+% do período/);
	});
});
