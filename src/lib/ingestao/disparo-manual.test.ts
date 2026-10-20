import { describe, it, expect } from "vitest";
import {
	COOLDOWN_SEGUNDOS,
	PENDURADA_MINUTOS,
	decidirDisparo,
} from "./disparo-manual";

const AGORA = new Date("2026-09-02T12:00:00Z");
const atras = (segundos: number) =>
	new Date(AGORA.getTime() - segundos * 1000).toISOString();

describe("decidirDisparo", () => {
	it("libera quando nunca houve execução", () => {
		expect(decidirDisparo(null, AGORA)).toEqual({ acao: "sincronizar" });
	});

	it("libera quando a última já passou do cooldown", () => {
		expect(
			decidirDisparo(
				{ status: "ok", iniciado_em: atras(600), terminado_em: atras(590) },
				AGORA,
			),
		).toEqual({ acao: "sincronizar" });
	});

	it("segura o clique nervoso e diz quanto falta", () => {
		const d = decidirDisparo(
			{ status: "ok", iniciado_em: atras(25), terminado_em: atras(20) },
			AGORA,
		);
		expect(d.acao).toBe("recente");
		if (d.acao === "recente") {
			expect(d.faltamSegundos).toBe(COOLDOWN_SEGUNDOS - 20);
		}
	});

	it("não abre uma segunda enquanto a primeira roda", () => {
		// Duas sincronizações concorrentes escrevem as mesmas linhas, e o
		// delete-antes-do-insert de uma apaga o histórico que a outra inseriu.
		const d = decidirDisparo(
			{ status: "executando", iniciado_em: atras(5), terminado_em: null },
			AGORA,
		);
		expect(d.acao).toBe("em_andamento");
	});

	it("destrava quando a execução em andamento está pendurada", () => {
		// Função que morreu no meio (timeout, deploy) deixa a linha em
		// "executando" para sempre. Sem este corte, o botão nunca mais funciona.
		const d = decidirDisparo(
			{
				status: "executando",
				iniciado_em: atras(PENDURADA_MINUTOS * 60 + 1),
				terminado_em: null,
			},
			AGORA,
		);
		expect(d.acao).toBe("sincronizar");
	});

	it("libera execução sem fim registrado e sem status de andamento", () => {
		// Linha malformada não pode travar o botão — o pior caso é uma
		// sincronização a mais, que é barata.
		expect(
			decidirDisparo(
				{ status: "com_erros", iniciado_em: atras(30), terminado_em: null },
				AGORA,
			),
		).toEqual({ acao: "sincronizar" });
	});

	it("o cooldown é curto de propósito", () => {
		// O botão existe para quem acabou de mexer no Pipefy. Cooldown longo
		// devolveria o problema que ele veio resolver.
		expect(COOLDOWN_SEGUNDOS).toBeLessThanOrEqual(120);
	});
});
