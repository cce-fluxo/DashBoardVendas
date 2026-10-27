import { describe, expect, it } from "vitest";

import { criarResolvedor, grafiasSemPessoa, iniciais, type GrafiaPessoa } from "./pessoas";

const g = (grafia: string, gestao: string | null, nome: string, id = 1): GrafiaPessoa => ({
	grafia,
	gestao,
	idPessoa: id,
	nomeExibicao: nome,
});

describe("criarResolvedor", () => {
	const resolver = criarResolvedor([
		g("Jonas Pimenta Thé", null, "Jonas Thé"),
		g("Jonas", "23/24", "Jonas Thé"),
		g("Rafa", "23/24", "Rafael Lima", 2),
		g("Rafa", "24/25", "Rafaela Costa", 3),
	]);

	it("grafia sem gestão vale em qualquer gestão", () => {
		expect(resolver("Jonas Pimenta Thé", "26/27")).toBe("Jonas Thé");
		expect(resolver("Jonas Pimenta Thé", null)).toBe("Jonas Thé");
	});

	it("grafia com gestão só vale nela", () => {
		expect(resolver("Jonas", "23/24")).toBe("Jonas Thé");
		expect(resolver("Jonas", "24/25")).toBe("Jonas");
	});

	it("o mesmo apelido em gestões diferentes pode ser outra pessoa", () => {
		expect(resolver("Rafa", "23/24")).toBe("Rafael Lima");
		expect(resolver("Rafa", "24/25")).toBe("Rafaela Costa");
	});

	it("casa pela forma normalizada, como vendedor.nome_vendedor", () => {
		expect(resolver("  jonas   pimenta thé ", "25/26")).toBe("Jonas Thé");
	});

	it("grafia sem pessoa continua sendo ela mesma", () => {
		expect(resolver("Fulano", "25/26")).toBe("Fulano");
	});
});

describe("grafiasSemPessoa", () => {
	it("lista só o que não resolve, com gestões, contratos e valor", () => {
		const vendas = [
			{ gestao: "23/24", valorContrato: 100, valorVendidoReal: 30, responsavel1: "Jonas", responsavel2: "Bombom" },
			{ gestao: "24/25", valorContrato: 50, valorVendidoReal: 40, responsavel1: "Bombom" },
			{ gestao: "25/26", valorContrato: 10, valorVendidoReal: 10, responsavel1: "Jonas Pimenta Thé" },
		];
		const sem = grafiasSemPessoa(vendas, [
			g("Jonas", "23/24", "Jonas Pimenta Thé"),
			g("Jonas Pimenta Thé", null, "Jonas Pimenta Thé"),
		]);
		// O nome exibido igual à grafia não pode ser confundido com "sem pessoa".
		// Valor: vendido real em 23/24 (30), valor do contrato em 24/25 (50).
		expect(sem).toEqual([
			{ grafia: "Bombom", gestoes: ["23/24", "24/25"], contratos: 2, valor: 80 },
		]);
	});
});

describe("iniciais", () => {
	it("primeira e última palavra", () => {
		expect(iniciais("Agatha Frossard")).toBe("AF");
		expect(iniciais("Ana Clara Belmonte")).toBe("AB");
	});
	it("nome de uma palavra usa as duas primeiras letras", () => {
		expect(iniciais("Jonas")).toBe("JO");
	});
});
