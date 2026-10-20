import { describe, expect, it } from "vitest";

import { abrirExecucao } from "./registro";

// `simular: true` devolve a execução inerte sem tocar no banco — é o caminho que
// dá para testar sem Supabase, e é o mesmo que roda em `--simular` e quando a
// migration 0003 não está aplicada.

describe("execução inerte", () => {
	it("não tem id — o que sinaliza que não há rastro nem colunas de linhagem", async () => {
		const e = await abrirExecucao({
			fonteTipo: "sheets",
			fonteRef: "PLANILHA",
			disparadoPor: "manual",
			simular: true,
		});
		expect(e.id).toBeNull();
	});

	it("acumula rejeições mesmo sem gravar", async () => {
		const e = await abrirExecucao({
			fonteTipo: "sheets",
			fonteRef: "PLANILHA",
			disparadoPor: "manual",
			simular: true,
		});

		e.rejeitar({ origemRef: "P#Contratos#L33", motivo: "sem nome de projeto" });
		e.rejeitarVarias([
			{ origemRef: "P#Contratos#L106", motivo: "sem coordenação" },
			{ origemRef: "P#Metas#C13", motivo: "meta não definida" },
		]);

		// A contagem serve para a simulação relatar o que aconteceria.
		expect(e.rejeicoes).toBe(3);
	});

	it("finalizar e falhar não lançam quando não há rastro", async () => {
		const e = await abrirExecucao({
			fonteTipo: "pipefy",
			fonteRef: "306460930",
			disparadoPor: "cron",
			simular: true,
		});

		await expect(e.finalizar({ lidas: 10, aceitas: 9 })).resolves.toBeUndefined();
		await expect(e.falhar(new Error("boom"))).resolves.toBeUndefined();
	});
});
