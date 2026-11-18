import { describe, expect, it } from "vitest";

import { correlacionar, montarOutbound, type CardCrm, type CardProspeccao } from "./outbound";

const fases = (...nomes: string[]) => ["Start form", "Base a abordar", ...nomes].map((fase) => ({ fase, em: "2026-11-13T12:00:00Z" }));

function prosp(id: string, p: Partial<CardProspeccao> = {}): CardProspeccao {
	return { pipefy_id: id, empresa: null, email_hash: null, telefone_hash: null, sdr: "Nicoly-maia-20242", data_criacao: "2026-11-12T12:00:00Z", fases: fases(), ...p };
}

function crm(etapas: string[], p: Partial<CardCrm> = {}): CardCrm {
	return { pipefy_id: "c1", empresa: null, email_hash: null, telefone_hash: null, data_criacao: "2026-11-20T12:00:00Z", etapa_atual: etapas[etapas.length - 1], historico: etapas.map((etapa) => ({ etapa })), ...p };
}

const resolver = (n: string) => (n === "Nicoly-maia-20242" ? "Nicoly Santos" : n);
const pontosNicoly = (p: CardProspeccao[], c: CardCrm[] = []) =>
	montarOutbound(p, c, resolver, new Map()).times[1].membros.find((m) => m.nome === "Nicoly Santos")!.pontos;

describe("pontos do outbound", () => {
	it("base sem abordagem não pontua; ligar vale 1", () => {
		expect(pontosNicoly([prosp("1")])).toBe(0);
		expect(pontosNicoly([prosp("1", { fases: fases("D1 · Tentativa") })])).toBe(1);
	});

	it("encerrado direto da base não é ligação", () => {
		expect(pontosNicoly([prosp("1", { fases: fases("Encerrado") })])).toBe(0);
	});

	it("pular fase não perde ponto: reunião marcada direto vale 1+2", () => {
		expect(pontosNicoly([prosp("1", { fases: fases("Reunião marcada (nutrição)") })])).toBe(3);
	});

	it("card arrastado de volta vale pela fase atual; encerrado mantém o histórico", () => {
		const f = fases("D1 · Tentativa", "Reunião marcada (nutrição)");
		expect(pontosNicoly([prosp("1", { fases: f, etapa_atual: "D1 · Tentativa" })])).toBe(1);
		expect(pontosNicoly([prosp("1", { fases: f, etapa_atual: "Encerrado" })])).toBe(3);
	});

	it("ligou, diag e proposta soma 11; venda soma 41", () => {
		const p = prosp("1", { email_hash: "e", fases: fases("D1 · Tentativa", "Reunião marcada (nutrição)", "Diagnóstico realizado") });
		expect(pontosNicoly([p], [crm(["Diagnóstico feito", "Proposta comercial feita"], { email_hash: "e" })])).toBe(11);
		expect(pontosNicoly([p], [crm(["Proposta comercial feita", "Venda"], { email_hash: "e" })])).toBe(41);
	});

	it("diagnóstico no CRM COM conta mesmo sem a fase na prospecção", () => {
		const p = prosp("1", { telefone_hash: "t", fases: fases("D1 · Tentativa") });
		expect(pontosNicoly([p], [crm(["Diagnóstico feito"], { telefone_hash: "t" })])).toBe(6);
	});
});

describe("correlacionar", () => {
	it("empresa com dois contatos credita a proposta uma vez, no mais avançado", () => {
		const a = prosp("a", { empresa: "Axx Care", fases: fases("D1 · Tentativa") });
		const b = prosp("b", { empresa: "AXX CARE", fases: fases("Diagnóstico realizado") });
		const r = correlacionar([a, b], [crm(["Proposta comercial feita"], { empresa: "Axx Care" })]);
		expect([...r]).toEqual([["b", 4]]);
	});

	it("card do CRM criado antes da prospecção não casa", () => {
		const p = prosp("1", { email_hash: "e" });
		expect(correlacionar([p], [crm(["Venda"], { email_hash: "e", data_criacao: "2026-01-01T00:00:00Z" })]).size).toBe(0);
	});

	it("e-mail tem prioridade sobre empresa", () => {
		const a = prosp("a", { empresa: "X Ltda", fases: fases("Diagnóstico realizado") });
		const b = prosp("b", { empresa: "X Ltda", email_hash: "e" });
		expect([...correlacionar([a, b], [crm(["Venda"], { empresa: "X Ltda", email_hash: "e" })])]).toEqual([["b", 5]]);
	});
});
