import { describe, expect, it } from "vitest";

import { agruparPendencias, type RejeicaoGravada } from "./coletar";

const PLANILHA = "planilhaAAAA";

function rej(
	idExecucao: number,
	local: string,
	motivo = "campo(s) obrigatório(s) sem valor: projeto",
	origem = PLANILHA,
): RejeicaoGravada {
	return {
		id_execucao: idExecucao,
		origem_ref: `${origem}#${local}`,
		motivo,
		campo: null,
		payload_bruto: null,
		criado_em: `2026-09-${String(idExecucao).padStart(2, "0")}T12:00:00Z`,
	};
}

describe("agruparPendencias", () => {
	it("some a pendência que a última carga da planilha não rejeitou mais", () => {
		// L65 foi rejeitada nas cargas 1 e 2; a carga 3 (a última) leu a planilha
		// corrigida e não a rejeitou. É o caso real da auditoria acusando "sem
		// valor" em linhas que o time já tinha preenchido.
		const r = [rej(1, "Contratos#L65"), rej(2, "Contratos#L65")];
		expect(agruparPendencias(r, new Map([[PLANILHA, 3]]))).toEqual([]);
	});

	it("mantém, com o histórico, a que a última carga ainda rejeita", () => {
		const r = [
			rej(1, "Contratos#L65"),
			rej(2, "Contratos#L65"),
			rej(3, "Contratos#L65"),
		];
		const p = agruparPendencias(r, new Map([[PLANILHA, 3]]));
		expect(p).toHaveLength(1);
		expect(p[0].ocorrencias).toBe(3);
		expect(p[0].primeiraEm).toBe("2026-09-01T12:00:00Z");
	});

	it("separa o resolvido do persistente na mesma planilha", () => {
		const r = [
			rej(1, "Contratos#L65"),
			rej(1, "Contratos#L80"),
			rej(2, "Contratos#L80"),
		];
		const p = agruparPendencias(r, new Map([[PLANILHA, 2]]));
		expect(p.map((x) => x.local)).toEqual(["Contratos · L80"]);
	});

	it("não esconde nada de fonte que não é planilha (leitura incremental)", () => {
		const r = [rej(1, "card-123", "fase desconhecida", "306460930")];
		expect(agruparPendencias(r, new Map([[PLANILHA, 9]]))).toHaveLength(1);
	});

	it("não esconde nada de planilha sem carga bem-sucedida: sem régua, sem baixa", () => {
		const r = [rej(1, "Contratos#L65")];
		expect(agruparPendencias(r, new Map())).toHaveLength(1);
	});

	it("ordena as mais antigas primeiro", () => {
		const r = [
			rej(5, "Contratos#L1"),
			rej(3, "Contratos#L2"),
			rej(5, "Contratos#L2"),
		];
		const p = agruparPendencias(r, new Map([[PLANILHA, 5]]));
		expect(p.map((x) => x.local)).toEqual(["Contratos · L2", "Contratos · L1"]);
	});
});
