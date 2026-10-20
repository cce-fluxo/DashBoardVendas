import { describe, it, expect } from "vitest";
import {
	TODAS,
	legendaDaImagem,
	nomeDoArquivo,
	rotuloCoordenacoes,
	rotuloDadoDe,
} from "./legenda";

describe("rotuloCoordenacoes", () => {
	it("diz 'todas' quando não há recorte", () => {
		expect(rotuloCoordenacoes([])).toBe(TODAS);
	});

	it("diz 'todas' também quando as cinco estão selecionadas", () => {
		// Lista cheia e lista vazia produzem o mesmo número. Escrever "CCE + ACE +
		// MNP + QAB + PRO" sugeriria um recorte que não existe.
		expect(rotuloCoordenacoes(["CCE", "ACE", "MNP", "QAB", "PRO"])).toBe(TODAS);
	});

	it("ordena, para que o mesmo recorte gere sempre o mesmo rótulo", () => {
		// Duas exportações do mesmo corte não podem diferir porque o usuário
		// clicou nos botões em outra sequência — o nome do arquivo depende disto.
		expect(rotuloCoordenacoes(["ACE", "CCE"])).toBe("CCE + ACE");
		expect(rotuloCoordenacoes(["CCE", "ACE"])).toBe("CCE + ACE");
	});

	it("nomeia a coordenação única", () => {
		expect(rotuloCoordenacoes(["QAB"])).toBe("QAB");
	});
});

describe("rotuloDadoDe", () => {
	it("não fica em silêncio quando não há carga", () => {
		expect(rotuloDadoDe(null)).toBe("sem carga registrada");
		expect(rotuloDadoDe(undefined)).toBe("sem carga registrada");
	});

	it("não inventa data a partir de texto inválido", () => {
		expect(rotuloDadoDe("ontem à tarde")).toBe("sem carga registrada");
	});

	it("nomeia a data da FONTE, não a de agora", () => {
		const texto = rotuloDadoDe("2026-08-31T14:20:00-03:00");
		expect(texto).toMatch(/^dado de \d{2}\/\d{2} \d{2}:\d{2}$/);
	});
});

describe("legendaDaImagem", () => {
	it("carrega o recorte de coordenação e a procedência", () => {
		const { recorte, procedencia } = legendaDaImagem({
			titulo: "Funil de Vendas",
			periodo: "Ciclo Revolução do Fogo · Out/2025–Dez/2025",
			coordenacoes: ["CCE"],
			dadoDe: "2026-08-31T14:20:00-03:00",
		});
		expect(recorte).toBe("CCE");
		expect(procedencia).toContain("Fluxo");
		expect(procedencia).toContain("dado de");
	});
});

describe("nomeDoArquivo", () => {
	const agora = new Date(2026, 7, 31, 15, 2); // 31/08/2026 15:02, hora local

	it("repete o recorte inteiro — é o que sobra quando a imagem é encaminhada", () => {
		const nome = nomeDoArquivo(
			{
				titulo: "Conversão",
				periodo: "Ciclo Revolução do Fogo",
				coordenacoes: ["CCE", "ACE"],
			},
			agora,
		);
		expect(nome).toBe(
			"conversao_ciclo-revolucao-do-fogo_cce-ace_2026-08-31-1502.png",
		);
	});

	it("marca 'todas' em vez de omitir a parte da coordenação", () => {
		const nome = nomeDoArquivo(
			{ titulo: "Funil", periodo: "Out/2025 — Set/2026", coordenacoes: [] },
			agora,
		);
		expect(nome).toBe(
			"funil_out-2025-set-2026_todas-as-coordenacoes_2026-08-31-1502.png",
		);
	});
});
