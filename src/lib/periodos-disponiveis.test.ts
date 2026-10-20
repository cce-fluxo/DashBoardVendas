import { describe, expect, it } from "vitest";
import { idsDeGestao } from "@/lib/fontes/registry";

import {
	ciclosDisponiveis,
	gestoesDisponiveis,
	mesesDisponiveis,
	reconciliarSelecao,
	rotuloGestao,
	selecaoPadrao,
} from "./periodos-disponiveis";

// Meio da gestão 25/26: Fogo, Forja e Era Industrial já ocorreram; Apollo
// (Jul–Set/2026) começou em julho.
const AGORA = new Date("2026-08-01T12:00:00.000Z");

describe("gestoesDisponiveis", () => {
	it("lista as gestões do registry, da mais recente para a mais antiga", () => {
		expect(gestoesDisponiveis().map((g) => g.valor)).toEqual([
			"25/26",
			"24/25",
			"23/24",
		]);
	});

	it("o rótulo carrega o intervalo, não só o código", () => {
		expect(rotuloGestao("24/25")).toBe("Gestão 24/25 · Out/2024–Set/2025");
	});
});

describe("ciclosDisponiveis", () => {
	it("oferece 3 ciclos em 24/25 — o seletor antigo oferecia 4", () => {
		const c = ciclosDisponiveis("24/25", AGORA);
		expect(c.map((x) => x.valor)).toEqual([
			"waterloo",
			"stalingrado",
			"normandia",
		]);
	});

	it("oferece 4 em 25/26 — estrutura diferente, lista diferente", () => {
		expect(ciclosDisponiveis("25/26", AGORA)).toHaveLength(4);
	});

	it("o rótulo diz o nome e o intervalo", () => {
		const [waterloo] = ciclosDisponiveis("24/25", AGORA);
		expect(waterloo.rotulo).toBe("Ciclo Waterloo · Out/2024–Jan/2025");
	});

	it("ciclo que ainda não começou vem desabilitado, com motivo", () => {
		// Em dezembro de 2025, só o Fogo (Out–Dez) começou.
		const dezembro = new Date("2025-12-10T12:00:00.000Z");
		const c = ciclosDisponiveis("25/26", dezembro);

		expect(c.find((x) => x.valor === "fogo")?.estado).toBe("disponivel");
		expect(c.find((x) => x.valor === "apollo")?.estado).toBe("futuro");
		expect(c.find((x) => x.valor === "apollo")?.motivo).toBe(
			"ainda não iniciado",
		);
	});

	it("numa gestão encerrada, todos os ciclos estão disponíveis", () => {
		expect(
			ciclosDisponiveis("23/24", AGORA).every((c) => c.estado === "disponivel"),
		).toBe(true);
	});
});

describe("mesesDisponiveis", () => {
	it("começa em outubro e termina em setembro", () => {
		const m = mesesDisponiveis("24/25", AGORA);
		expect(m[0].valor).toBe("10");
		expect(m[11].valor).toBe("09");
	});

	it("o rótulo tem o ano certo dos dois lados da virada", () => {
		const m = mesesDisponiveis("24/25", AGORA);
		expect(m.find((x) => x.valor === "10")?.rotulo).toBe("Outubro/2024");
		expect(m.find((x) => x.valor === "01")?.rotulo).toBe("Janeiro/2025");
	});

	it("mês futuro fica desabilitado — antes levava a uma tela zerada", () => {
		const m = mesesDisponiveis("25/26", AGORA);
		// Agosto/2026 já começou; setembro/2026 não.
		expect(m.find((x) => x.valor === "08")?.estado).toBe("disponivel");
		expect(m.find((x) => x.valor === "09")?.estado).toBe("futuro");
	});
});

describe("reconciliarSelecao", () => {
	it("ciclo que existe nas duas gestões é mantido sem aviso", () => {
		const r = reconciliarSelecao(
			{ tipo: "ciclo", gestao: "24/25", ciclo: "waterloo" },
			"23/24",
			AGORA,
		);
		// "waterloo" não existe em 23/24 — cai no equivalente por mês inicial.
		expect(r.selecao.ciclo).toBe("fuji");
		expect(r.aviso).toMatch(/mesmo trecho do ano/);
	});

	it("escolhe o ciclo que cobre o mesmo mês inicial", () => {
		// Apollo (25/26) começa em julho. Em 24/25, julho está no Normandia.
		const r = reconciliarSelecao(
			{ tipo: "ciclo", gestao: "25/26", ciclo: "apollo" },
			"24/25",
			AGORA,
		);
		expect(r.selecao.ciclo).toBe("normandia");
		expect(r.aviso).toContain("Ciclo Apollo");
	});

	it("nunca deixa o seletor num ciclo inexistente", () => {
		for (const destino of ["23/24", "24/25", "25/26"]) {
			const r = reconciliarSelecao(
				{ tipo: "ciclo", gestao: "25/26", ciclo: "era-industrial" },
				destino,
				AGORA,
			);
			if (r.selecao.tipo === "ciclo") {
				expect(
					ciclosDisponiveis(destino, AGORA).map((c) => c.valor),
				).toContain(r.selecao.ciclo);
			}
		}
	});

	it("mês é mantido entre gestões — a estrutura mensal não muda", () => {
		const r = reconciliarSelecao(
			{ tipo: "mes", gestao: "25/26", mes: "03" },
			"24/25",
			AGORA,
		);
		expect(r.selecao).toEqual({ tipo: "mes", gestao: "24/25", mes: "03" });
		expect(r.aviso).toBeUndefined();
	});

	it("mês que ainda não aconteceu na gestão de destino cai para a gestão", () => {
		const r = reconciliarSelecao(
			{ tipo: "mes", gestao: "24/25", mes: "09" },
			"25/26",
			AGORA,
		);
		expect(r.selecao.tipo).toBe("gestao");
		expect(r.aviso).toMatch(/ainda não aconteceu/);
	});

	it("seleção de gestão inteira atravessa sem ruído", () => {
		const r = reconciliarSelecao(
			{ tipo: "gestao", gestao: "25/26" },
			"23/24",
			AGORA,
		);
		expect(r.selecao).toEqual({ tipo: "gestao", gestao: "23/24" });
		expect(r.aviso).toBeUndefined();
	});

	it("gestão sem fonte cadastrada avisa em vez de quebrar", () => {
		const r = reconciliarSelecao(
			{ tipo: "gestao", gestao: "25/26" },
			"29/30",
			AGORA,
		);
		expect(r.aviso).toMatch(/não tem fonte cadastrada/);
	});
});

describe("selecaoPadrao", () => {
	it("é a gestão vigente pela data, não uma constante", () => {
		expect(selecaoPadrao(AGORA)).toEqual({ tipo: "gestao", gestao: "25/26" });
	});

	it("nunca aponta para uma gestão fora do registry — a tela não pode quebrar na virada", () => {
		// Em 2031 a vigente seria 31/32, que não está cadastrada: cai para a mais
		// recente que está, em vez de entregar à tela um id que `buscarGestao` recusa.
		const gestao = selecaoPadrao(new Date("2031-11-02T12:00:00.000Z")).gestao;
		expect(idsDeGestao()).toContain(gestao);
	});
});
