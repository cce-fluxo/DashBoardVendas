import { describe, expect, it } from "vitest";
import { ehLeituraVazia, exigirLeitura, LeituraVazia } from "@/lib/cache";

describe("exigirLeitura", () => {
	it("passa quando todas as listas têm dados", () => {
		expect(() => exigirLeitura({ cards: [1], vendas: [1, 2] })).not.toThrow();
	});

	it("lança com o nome da lista vazia — leitura que falhou não pode virar zero guardado", () => {
		expect(() => exigirLeitura({ cards: [1], vendas: [] })).toThrow(/"vendas"/);
	});
});

describe("ehLeituraVazia", () => {
	it("reconhece a própria classe", () => {
		expect(ehLeituraVazia(new LeituraVazia("cards"))).toBe(true);
	});

	it("reconhece pelo nome, para o erro que atravessou o cache", () => {
		const atravessado = new Error("qualquer");
		atravessado.name = "LeituraVazia";
		expect(ehLeituraVazia(atravessado)).toBe(true);
	});

	it("não confunde com outros erros", () => {
		expect(ehLeituraVazia(new Error("timeout"))).toBe(false);
		expect(ehLeituraVazia("LeituraVazia")).toBe(false);
	});
});
