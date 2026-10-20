import { describe, expect, it } from "vitest";

import { normalizarCabecalho, letraColuna } from "./normalizar";
import { lerTabela, resolverColunas, ErroLeituraPlanilha } from "./tabela";
import {
	mesesDoCiclo,
	validarCalendario,
	verificarGestao,
	MESES_DA_GESTAO,
} from "./calendario";
import {
	GESTOES,
	buscarGestao,
	gestaoPadraoDaTela,
	gestoesDoCron,
	idGestaoVigente,
} from "./registry";
import { lerMetas, mesDoRotulo, parsearValorMeta } from "./blocos";
import {
	acharOrfaos,
	chaveMeta,
	chaveProjeto,
	mapearContratos,
	mesParaData,
	normalizarCoordenacao,
	normalizarNomeVendedor,
	parsearValorBR,
} from "./mapear";
import type { FonteTabela, Gestao } from "./tipos";

// ─── Normalização de cabeçalho ────────────────────────────────────

describe("normalizarCabecalho", () => {
	it("unifica º ordinal e ° de grau — o caso real 23/24 × 24/25", () => {
		expect(normalizarCabecalho("Nº Parcelas")).toBe(
			normalizarCabecalho("N° Parcelas"),
		);
	});

	it("colapsa quebra de linha dentro da célula", () => {
		// Cabeçalho real da planilha de 25/26.
		expect(normalizarCabecalho("Data de Finalização\n(Estimativa)")).toBe(
			"data de finalizacao (estimativa)",
		);
	});

	it("ignora acento, capitalização e espaço extra", () => {
		expect(normalizarCabecalho("  CANAL de Aquisição ")).toBe(
			"canal de aquisicao",
		);
	});

	it("trata vazio e indefinido sem quebrar", () => {
		expect(normalizarCabecalho("")).toBe("");
		expect(normalizarCabecalho(undefined as unknown as string)).toBe("");
	});
});

describe("letraColuna", () => {
	it("mapeia índice 0-based para letra de coluna", () => {
		expect(letraColuna(0)).toBe("A");
		expect(letraColuna(25)).toBe("Z");
		expect(letraColuna(26)).toBe("AA");
	});
});

// ─── Leitor de tabela ─────────────────────────────────────────────

function fonteDeTeste(over: Partial<FonteTabela> = {}): FonteTabela {
	return {
		estrategia: "tabela",
		spreadsheetId: "PLANILHA",
		aba: "Contratos",
		linhaCabecalho: 1,
		colunas: {
			mes: { tipo: "posicao", indice: 0, motivo: "sem cabeçalho" },
			projeto: { tipo: "cabecalho", nome: "Projetos Assinados" },
			coordenacao: { tipo: "cabecalho", nome: "Coordenação" },
			valorVendidoReal: { tipo: "cabecalho", nome: "Valor Vendido real" },
			valorContrato: { tipo: "cabecalho", nome: "Valor contrato" },
		},
		obrigatorios: ["mes", "projeto", "coordenacao"],
		...over,
	};
}

const GRADE = [
	["", "Projetos Assinados", "Coordenação", "Valor Vendido real", "Valor contrato"],
	["outubro/2025", "DI Padaria Alfa", "ACE", "R$ 3.500,00", "R$ 3.500,00"],
	["novembro/2025", "EV Fazenda Beta", "PRO", "R$ 7.000,00", "R$ 7.200,00"],
];

describe("lerTabela", () => {
	it("resolve colunas por nome e devolve linhagem por linha", () => {
		const t = lerTabela("25/26", fonteDeTeste(), GRADE);

		expect(t.linhas).toHaveLength(2);
		expect(t.linhas[0].valores.projeto).toBe("DI Padaria Alfa");
		expect(t.linhas[0].valores.mes).toBe("outubro/2025");
		// Linha 2 da planilha: cabeçalho é a 1.
		expect(t.linhas[0].linhaPlanilha).toBe(2);
		expect(t.linhas[0].origemRef).toBe("PLANILHA#Contratos#L2");
	});

	it("é imune à ordem das colunas — o caso das duas datas trocadas", () => {
		const trocada = [
			["", "Coordenação", "Valor contrato", "Projetos Assinados", "Valor Vendido real"],
			["outubro/2025", "ACE", "R$ 9,00", "DI Padaria Alfa", "R$ 8,00"],
		];
		const t = lerTabela("25/26", fonteDeTeste(), trocada);
		expect(t.linhas[0].valores.projeto).toBe("DI Padaria Alfa");
		expect(t.linhas[0].valores.valorVendidoReal).toBe("R$ 8,00");
		expect(t.linhas[0].valores.valorContrato).toBe("R$ 9,00");
	});

	it("falha NOMEANDO a coluna quando um obrigatório some", () => {
		const semCoord = [
			["", "Projetos Assinados", "Valor Vendido real"],
			["outubro/2025", "DI Padaria Alfa", "R$ 1,00"],
		];
		expect(() => lerTabela("25/26", fonteDeTeste(), semCoord)).toThrow(
			ErroLeituraPlanilha,
		);
		expect(() => lerTabela("25/26", fonteDeTeste(), semCoord)).toThrow(
			/Coordenação/,
		);
	});

	it("recusa cabeçalho ambíguo em vez de escolher um", () => {
		// A aba "Metas por coordenação" tem oito cabeçalhos repetidos.
		const duplicado = [
			["", "Projetos Assinados", "Coordenação", "Coordenação", "Valor Vendido real"],
			["outubro/2025", "DI Padaria Alfa", "ACE", "PRO", "R$ 1,00"],
		];
		expect(() => lerTabela("25/26", fonteDeTeste(), duplicado)).toThrow(
			/mais de uma vez/,
		);
	});

	it("tolera linha curta — o Sheets corta células vazias no fim", () => {
		// Falta só `valorContrato`, que é opcional nesta fonte.
		const curta = [...GRADE, ["dezembro/2025", "PN Rede Gama", "CCE", "R$ 5,00"]];
		const t = lerTabela("25/26", fonteDeTeste(), curta);
		expect(t.linhas).toHaveLength(3);
		expect(t.linhas[2].valores.valorContrato).toBe("");
	});

	it("ignora ruído estrutural — só colunas de valor preenchidas", () => {
		// Caso real: a aba de 23/24 tem 343 linhas de fórmula arrastada com
		// "R$ 0,00" em DUAS colunas de valor e nada mais. Contar células
		// preenchidas as classificaria como rejeição; o que vale é não haver
		// nenhum campo obrigatório.
		const ruido = [
			...GRADE,
			[],
			["", "", "", "R$ 0,00", "R$ 0,00"],
			["", "", "", "R$ 0,00"],
		];
		const t = lerTabela("25/26", fonteDeTeste(), ruido);
		expect(t.linhas).toHaveLength(2);
		expect(t.descartadas).toHaveLength(0);
		expect(t.ignoradas).toBe(3);
	});

	it("aceita contrato sem valor preenchido — L84 de 23/24", () => {
		// Assinado, com coordenação e data, mas ninguém preencheu o valor.
		// É contrato: entra com zero, e o zero fica visível.
		const semValor = [...GRADE, ["julho/2024", "Acompanhamento Oficina Delta", "MNP"]];
		const t = lerTabela("23/24", fonteDeTeste(), semValor);

		expect(t.linhas).toHaveLength(3);
		expect(t.descartadas).toHaveLength(0);
		expect(t.linhas[2].valores.projeto).toBe("Acompanhamento Oficina Delta");
		expect(t.linhas[2].valores.valorVendidoReal).toBe("");
	});

	it("descarta linha sem coordenação, dizendo o que faltou — L106 de 23/24", () => {
		// Só nome e mês: não dá para afirmar que o projeto aconteceu.
		const incompleta = [...GRADE, ["setembro/2024", "EDVF Indústria Épsilon"]];
		const t = lerTabela("23/24", fonteDeTeste(), incompleta);

		expect(t.linhas).toHaveLength(2);
		expect(t.descartadas).toHaveLength(1);
		expect(t.descartadas[0].linhaPlanilha).toBe(4);
		expect(t.descartadas[0].camposFaltando).toEqual(["coordenacao"]);
		// O payload bruto sobrevive para diagnóstico.
		expect(t.descartadas[0].valores.projeto).toBe("EDVF Indústria Épsilon");
	});

	it("descarta contrato completo mas sem nome — L33 de 23/24", () => {
		// 13 células preenchidas e R$ 2.120,00, faltando só a coluna do projeto.
		// Precisa aparecer como rejeição; some junto com o ruído seria o pior caso.
		const semNome = [...GRADE, ["janeiro/2024", "", "ACE", "R$ 2.120,00", "R$ 2.120,00"]];
		const t = lerTabela("23/24", fonteDeTeste(), semNome);

		expect(t.linhas).toHaveLength(2);
		expect(t.ignoradas).toBe(0);
		expect(t.descartadas).toHaveLength(1);
		expect(t.descartadas[0].camposFaltando).toEqual(["projeto"]);
		expect(t.descartadas[0].valores.valorVendidoReal).toBe("R$ 2.120,00");
	});

	it("aceita coluna opcional ausente sem reclamar", () => {
		const fonte = fonteDeTeste({
			colunas: {
				...fonteDeTeste().colunas,
				contratante: { tipo: "cabecalho", nome: "Contratante" },
			},
		});
		const t = lerTabela("24/25", fonte, GRADE);
		expect(t.resolucao.contratante).toBeUndefined();
		expect(t.linhas[0].valores.contratante).toBeUndefined();
	});

	it("resolverColunas casa mesmo com acento e caixa diferentes", () => {
		const r = resolverColunas(fonteDeTeste(), [
			"",
			"projetos assinados",
			"COORDENACAO",
			"valor vendido REAL",
			"Valor Contrato",
		]);
		expect(r.projeto).toBe(1);
		expect(r.coordenacao).toBe(2);
	});
});

// ─── Calendário ───────────────────────────────────────────────────

describe("mesesDoCiclo", () => {
	it("cobre ciclo de 4 meses que vira o ano civil (Out→Jan)", () => {
		expect(
			mesesDoCiclo({ id: "w", rotulo: "", mesInicio: "10", mesFim: "01" }),
		).toEqual(["10", "11", "12", "01"]);
	});

	it("cobre ciclo de 3 meses dentro do ano (Jan→Mar)", () => {
		expect(
			mesesDoCiclo({ id: "f", rotulo: "", mesInicio: "01", mesFim: "03" }),
		).toEqual(["01", "02", "03"]);
	});
});

function gestaoSintetica(ciclos: Gestao["ciclos"]): Gestao {
	return {
		id: "27/28",
		anoInicio: 2027,
		ciclos,
		contratos: fonteDeTeste(),
	};
}

describe("verificarGestao", () => {
	it("aceita 3 ciclos de 4 meses", () => {
		const g = gestaoSintetica([
			{ id: "a", rotulo: "A", mesInicio: "10", mesFim: "01" },
			{ id: "b", rotulo: "B", mesInicio: "02", mesFim: "05" },
			{ id: "c", rotulo: "C", mesInicio: "06", mesFim: "09" },
		]);
		expect(verificarGestao(g)).toEqual([]);
	});

	it("detecta mês órfão — o caso Ciclo Andes", () => {
		// Se maio ficasse de fora por causa do FIM em 30/05.
		const g = gestaoSintetica([
			{ id: "a", rotulo: "A", mesInicio: "10", mesFim: "01" },
			{ id: "b", rotulo: "B", mesInicio: "02", mesFim: "04" },
			{ id: "c", rotulo: "C", mesInicio: "06", mesFim: "09" },
		]);
		const p = verificarGestao(g);
		expect(p).toHaveLength(1);
		expect(p[0].problema).toMatch(/sem ciclo: 05/);
	});

	it("detecta sobreposição entre ciclos", () => {
		const g = gestaoSintetica([
			{ id: "a", rotulo: "A", mesInicio: "10", mesFim: "02" },
			{ id: "b", rotulo: "B", mesInicio: "02", mesFim: "05" },
			{ id: "c", rotulo: "C", mesInicio: "06", mesFim: "09" },
		]);
		expect(
			verificarGestao(g).some((x) => /mais de um ciclo/.test(x.problema)),
		).toBe(true);
	});

	it("detecta id de gestão fora do formato AA/BB", () => {
		const g = { ...gestaoSintetica([]), id: "2027" };
		expect(verificarGestao(g).some((x) => /formato AA\/BB/.test(x.problema))).toBe(
			true,
		);
	});

	it("detecta anos não consecutivos", () => {
		const g = { ...gestaoSintetica([]), id: "27/29" };
		expect(
			verificarGestao(g).some((x) => /primeiro \+ 1/.test(x.problema)),
		).toBe(true);
	});
});

// ─── Registry ─────────────────────────────────────────────────────

describe("registry", () => {
	it("o calendário real das três gestões é válido", () => {
		expect(() => validarCalendario(GESTOES)).not.toThrow();
	});

	it("cada gestão cobre exatamente os 12 meses", () => {
		for (const g of GESTOES) {
			const meses = g.ciclos.flatMap(mesesDoCiclo);
			expect(new Set(meses).size, `gestão ${g.id}`).toBe(MESES_DA_GESTAO.length);
		}
	});

	it("23/24 e 24/25 têm 3 ciclos; 25/26 tem 4", () => {
		expect(buscarGestao("23/24").ciclos).toHaveLength(3);
		expect(buscarGestao("24/25").ciclos).toHaveLength(3);
		expect(buscarGestao("25/26").ciclos).toHaveLength(4);
	});

	it("os ciclos de 24/25 batem com a planilha oficial", () => {
		const ciclos = buscarGestao("24/25").ciclos;
		expect(ciclos.map((c) => c.id)).toEqual([
			"waterloo",
			"stalingrado",
			"normandia",
		]);
		// Waterloo termina em janeiro — é o mês que o código antigo perdia.
		expect(mesesDoCiclo(ciclos[0])).toEqual(["10", "11", "12", "01"]);
		expect(mesesDoCiclo(ciclos[1])).toEqual(["02", "03", "04", "05"]);
		expect(mesesDoCiclo(ciclos[2])).toEqual(["06", "07", "08", "09"]);
	});

	it("gestão desconhecida lança nomeando as conhecidas", () => {
		expect(() => buscarGestao("99/00")).toThrow(/23\/24/);
	});
});

describe("idGestaoVigente", () => {
	it("outubro inicia a gestão nova", () => {
		expect(idGestaoVigente(new Date("2026-10-01T00:00:00Z"))).toBe("26/27");
	});

	it("30 de setembro ainda é a gestão anterior", () => {
		expect(idGestaoVigente(new Date("2026-09-30T23:00:00Z"))).toBe("25/26");
	});

	it("meses de janeiro a setembro ficam na gestão iniciada no ano anterior", () => {
		expect(idGestaoVigente(new Date("2026-03-15T12:00:00Z"))).toBe("25/26");
	});

	it("funciona numa gestão futura sem nenhuma alteração de código", () => {
		expect(idGestaoVigente(new Date("2031-11-02T12:00:00Z"))).toBe("31/32");
	});
});

describe("gestoesDoCron", () => {
	it("devolve só a gestão vigente", () => {
		const g = gestoesDoCron(new Date("2026-03-15T12:00:00Z"));
		expect(g.map((x) => x.id)).toEqual(["25/26"]);
	});

	it("sem fonte para a vigente, sincroniza a mais recente cadastrada — nunca zero", () => {
		// Uma gestão futura que ninguém cadastrou. Foi o que aconteceu em 01/10/2026
		// (26/27 ainda sem planilha) e parou o cron; a data aqui é deliberadamente
		// distante para o teste não depender de quando a próxima for cadastrada.
		const g = gestoesDoCron(new Date("2031-11-02T12:00:00Z"));
		expect(g).toHaveLength(1);
		expect(g[0].id).toBe(
			[...GESTOES].sort((a, b) => b.anoInicio - a.anoInicio)[0].id,
		);
	});
});

describe("gestaoPadraoDaTela", () => {
	it("é a vigente quando ela está cadastrada", () => {
		expect(gestaoPadraoDaTela(new Date("2026-03-15T12:00:00Z"))).toBe("25/26");
	});

	it("cai para a mais recente cadastrada quando a vigente não tem fonte", () => {
		const ate2526 = GESTOES.filter((g) => g.id !== "26/27");
		expect(gestaoPadraoDaTela(new Date("2026-10-04T12:00:00Z"), ate2526)).toBe(
			"25/26",
		);
	});

	it("volta a ser a vigente assim que ela é cadastrada", () => {
		const com2627 = [
			...GESTOES,
			{ ...GESTOES[GESTOES.length - 1], id: "26/27", anoInicio: 2026 },
		];
		expect(gestaoPadraoDaTela(new Date("2026-10-04T12:00:00Z"), com2627)).toBe(
			"26/27",
		);
	});
});

// ─── Leitor de blocos (metas) ─────────────────────────────────────

describe("parsearValorMeta", () => {
	it("lê moeda em pt-BR com e sem centavos", () => {
		expect(parsearValorMeta("R$ 1.234.567")).toBe(1234567);
		expect(parsearValorMeta("R$ 85.000,00")).toBe(85000);
		expect(parsearValorMeta(" R$  85.000,00 ")).toBe(85000);
	});

	it("trata '???' como meta AUSENTE, não como zero", () => {
		// Caso real: o 4º ciclo de 25/26 ainda não foi precificado.
		expect(parsearValorMeta("???")).toBeNull();
		expect(parsearValorMeta("")).toBeNull();
	});

	it("recusa texto que não é número", () => {
		expect(parsearValorMeta("a definir")).toBeNull();
	});
});

describe("mesDoRotulo", () => {
	it("extrai o mês ignorando o ano", () => {
		expect(mesDoRotulo("outubro/2025")).toBe("10");
		expect(mesDoRotulo("março/2024")).toBe("03");
	});

	it("descarta o ano de propósito — rótulos de 25/26 estão defasados", () => {
		// A planilha de 25/26 rotula os meses como 2024/2025; usar o ano jogaria
		// as metas dentro da gestão anterior.
		expect(mesDoRotulo("outubro/2024")).toBe(mesDoRotulo("outubro/2025"));
	});

	it("devolve null para rótulo que não é mês", () => {
		expect(mesDoRotulo("total")).toBeNull();
		expect(mesDoRotulo("PROJETADO REALISTA")).toBeNull();
	});
});

function gestaoComMetas(): Gestao {
	return {
		id: "24/25",
		anoInicio: 2024,
		ciclos: [
			{ id: "waterloo", rotulo: "Ciclo Waterloo", mesInicio: "10", mesFim: "01" },
			{ id: "normandia", rotulo: "Ciclo Normandia", mesInicio: "02", mesFim: "09" },
		],
		contratos: fonteDeTeste(),
		metas: {
			estrategia: "blocos",
			spreadsheetId: "PLANILHA",
			aba: "Metas por coordenação",
			colunaBlocosB: 1,
			colunaBlocosCiclo: 4,
			ancoraMensal: "METAS",
			ancoraFimMensal: "total",
			prefixoCiclo: "Ciclo",
		},
	};
}

/** Grade mínima que reproduz o layout real: METAS em B, ciclos em E. */
function gradeDeMetas(): string[][] {
	const g: string[][] = Array.from({ length: 24 }, () => []);
	const set = (linha: number, coluna: number, v: string) => {
		g[linha - 1][coluna] = v;
	};

	set(3, 1, "METAS");
	set(4, 1, "outubro/2024"); set(4, 2, "R$ 120.000");
	set(5, 1, "novembro/2024"); set(5, 2, "R$ 100.000");
	set(6, 1, "total"); set(6, 2, "R$ 220.000");
	// Segundo bloco na MESMA coluna — não pode ser lido como meta.
	set(8, 1, "PROJETADO REALISTA");
	set(9, 1, "outubro/2024"); set(9, 2, "R$ 85.181");

	set(3, 4, "Ciclo Waterloo"); set(3, 5, "FIM:"); set(3, 6, "31/01/2025");
	set(4, 4, "ACE"); set(4, 5, "R$ 35.000");
	set(5, 4, "PRO"); set(5, 5, "R$ 40.000");
	set(6, 4, "Fluxo"); set(6, 5, "R$ 75.000");

	// Nome placeholder: precisa casar pela data FIM.
	set(8, 4, "Ciclo XXX"); set(8, 5, "FIM:"); set(8, 6, "30/09/2025");
	set(9, 4, "ACE"); set(9, 5, "???");
	set(10, 4, "PRO"); set(10, 5, "R$ 50.000");

	return g;
}

describe("lerMetas", () => {
	it("para o bloco mensal em 'total' — não invade PROJETADO REALISTA", () => {
		const r = lerMetas(gestaoComMetas(), gradeDeMetas());
		const mensais = r.metas.filter((m) => m.tipo === "mes");
		// Só outubro e novembro; o outubro do bloco de projeção fica de fora.
		expect(mensais).toHaveLength(2);
		expect(mensais.map((m) => m.valor)).toEqual([120000, 100000]);
	});

	it("a linha 'total' vira a meta de gestão da Fluxo", () => {
		const r = lerMetas(gestaoComMetas(), gradeDeMetas());
		const g = r.metas.find((m) => m.tipo === "gestao");
		expect(g?.valor).toBe(220000);
		expect(g?.coordenacao).toBeNull();
	});

	it("casa o ciclo pela data FIM mesmo com nome placeholder", () => {
		const r = lerMetas(gestaoComMetas(), gradeDeMetas());
		const doCiclo = r.metas.filter(
			(m) => m.tipo === "ciclo" && m.periodo === "normandia",
		);
		expect(doCiclo).toHaveLength(1); // PRO; ACE é "???"
		expect(doCiclo[0].coordenacao).toBe("PRO");
	});

	it("nome divergente é NOTA, não aviso — o ciclo só é batizado quando chega", () => {
		const r = lerMetas(gestaoComMetas(), gradeDeMetas());
		expect(r.notas.some((n) => /Ciclo XXX/.test(n))).toBe(true);
		expect(r.avisos.some((a) => /Ciclo XXX/.test(a))).toBe(false);
	});

	it("mas AVISA quando o registry ainda tem nome provisório e a planilha revelou", () => {
		const gestao = gestaoComMetas();
		gestao.ciclos[1] = { ...gestao.ciclos[1], rotuloProvisorio: true };

		const r = lerMetas(gestao, gradeDeMetas());
		expect(
			r.avisos.some((a) => /já revelou o nome "Ciclo XXX"/.test(a)),
		).toBe(true);
	});

	it("meta '???' vira ilegível com motivo, nunca zero", () => {
		const r = lerMetas(gestaoComMetas(), gradeDeMetas());
		const ace = r.ilegiveis.find((i) => i.rotulo.includes("ACE"));
		expect(ace?.bruto).toBe("???");
		expect(ace?.motivo).toMatch(/não definida/);
		// E não entrou como meta de valor zero.
		expect(
			r.metas.some((m) => m.periodo === "normandia" && m.coordenacao === "ACE"),
		).toBe(false);
	});

	it("separa Fluxo (coordenacao null) das coordenações no bloco de ciclo", () => {
		const r = lerMetas(gestaoComMetas(), gradeDeMetas());
		const w = r.metas.filter((m) => m.periodo === "waterloo");
		expect(w.find((m) => m.coordenacao === null)?.valor).toBe(75000);
		expect(w.filter((m) => m.coordenacao !== null)).toHaveLength(2);
	});

	it("não colide: o 'Fluxo' do bloco GESTÃO não vira meta — caso real de 25/26", () => {
		// A meta de gestão da Fluxo é o `total` do bloco mensal. O "Fluxo" do
		// bloco GESTÃO tem a mesma chave e sobrescreveria a outra no banco.
		const g = gradeDeMetas();
		g[18] = []; g[18][1] = "GESTÃO";
		g[19] = []; g[19][1] = "ACE"; g[19][2] = "R$ 130.000";
		g[20] = []; g[20][1] = "Fluxo"; g[20][2] = "R$ 900.000";

		const gestao = gestaoComMetas();
		gestao.metas!.ancoraGestao = "GESTÃO";

		const r = lerMetas(gestao, g);

		// Uma única meta de gestão para a Fluxo, e é a do bloco mensal.
		const gerais = r.metas.filter(
			(m) => m.tipo === "gestao" && m.coordenacao === null,
		);
		expect(gerais).toHaveLength(1);
		expect(gerais[0].valor).toBe(220000);

		// A coordenação do bloco GESTÃO entra normalmente.
		expect(
			r.metas.find((m) => m.tipo === "gestao" && m.coordenacao === "ACE")?.valor,
		).toBe(130000);

		// Nenhuma colisão sobra. A divergência entre os dois totais é esperada,
		// então fica em notas — aviso em toda rodada ninguém lê.
		expect(r.avisos.some((a) => a.startsWith("COLISÃO"))).toBe(false);
		expect(r.notas.some((n) => /divergir é esperado/.test(n))).toBe(true);
	});

	it("ainda detecta colisão de chave se ela surgir", () => {
		// Rede de segurança: dois blocos de ciclo apontando para o mesmo ciclo.
		const g = gradeDeMetas();
		g[12] = []; g[12][4] = "Ciclo Waterloo"; g[12][5] = "FIM:"; g[12][6] = "31/01/2025";
		g[13] = []; g[13][4] = "ACE"; g[13][5] = "R$ 99.000";

		const r = lerMetas(gestaoComMetas(), g);
		expect(r.avisos.some((a) => a.startsWith("COLISÃO"))).toBe(true);
	});
});

describe("meta de gestão por coordenação derivada dos ciclos", () => {
	it("deriva somando os ciclos quando o bloco GESTÃO não existe", () => {
		const r = lerMetas(gestaoComMetas(), gradeDeMetas());
		// PRO tem meta nos dois ciclos: 40.000 (waterloo) + 50.000 (normandia).
		const pro = r.metas.find(
			(m) => m.tipo === "gestao" && m.coordenacao === "PRO",
		);
		expect(pro?.valor).toBe(90000);
		expect(pro?.derivada).toBe(true);
		expect(pro?.origemRef).toMatch(/derivado: soma das metas de ciclo/);
	});

	it("NÃO deriva coordenação que falta em algum ciclo — somar parte mentiria", () => {
		const r = lerMetas(gestaoComMetas(), gradeDeMetas());
		// ACE só tem meta em waterloo; em normandia é "???".
		expect(
			r.metas.some((m) => m.tipo === "gestao" && m.coordenacao === "ACE"),
		).toBe(false);
		expect(r.avisos.some((a) => /ACE NÃO derivada/.test(a))).toBe(true);
	});

	it("não deriva quando o bloco GESTÃO existe — a planilha manda", () => {
		const g = gradeDeMetas();
		g[18] = []; g[18][1] = "GESTÃO";
		g[19] = []; g[19][1] = "PRO"; g[19][2] = "R$ 250.000";

		const gestao = gestaoComMetas();
		gestao.metas!.ancoraGestao = "GESTÃO";

		const r = lerMetas(gestao, g);
		const pro = r.metas.find(
			(m) => m.tipo === "gestao" && m.coordenacao === "PRO",
		);
		expect(pro?.valor).toBe(250000); // lido, não os 90.000 derivados
		expect(pro?.derivada).toBeUndefined();
	});
})

// ─── Mapeamento para o banco ──────────────────────────────────────

describe("parsearValorBR", () => {
	it("lê moeda pt-BR", () => {
		expect(parsearValorBR("R$ 7.027,80")).toBeCloseTo(7027.8);
		expect(parsearValorBR("R$ 70.560,00")).toBe(70560);
	});

	it("valor ausente vira 0 — contrato assinado sem valor é contrato", () => {
		expect(parsearValorBR("")).toBe(0);
		expect(parsearValorBR(undefined)).toBe(0);
	});
});

describe("mesParaData", () => {
	it("meses 10-12 caem no primeiro ano da gestão", () => {
		expect(mesParaData("outubro/2025", 2025)).toBe("2025-10-01");
		expect(mesParaData("dezembro/2025", 2025)).toBe("2025-12-01");
	});

	it("meses 01-09 caem no segundo ano", () => {
		expect(mesParaData("janeiro/2026", 2025)).toBe("2026-01-01");
		expect(mesParaData("setembro/2026", 2025)).toBe("2026-09-01");
	});

	it("IGNORA o ano do rótulo — os de 25/26 estão defasados", () => {
		// Mesmo rotulado como 2024, outubro da gestão 25/26 é outubro de 2025.
		expect(mesParaData("outubro/2024", 2025)).toBe("2025-10-01");
	});

	it("rótulo que não é mês devolve null", () => {
		expect(mesParaData("total", 2025)).toBeNull();
		expect(mesParaData("", 2025)).toBeNull();
	});
});

describe("normalizarCoordenacao", () => {
	it("aceita as cinco, em qualquer caixa", () => {
		expect(normalizarCoordenacao("ace")).toBe("ACE");
		expect(normalizarCoordenacao(" QAB ")).toBe("QAB");
	});

	it("devolve null fora do padrão — nada de cair para CCE", () => {
		// O parser antigo (sheets.ts:89) convertia qualquer coisa em "CCE".
		expect(normalizarCoordenacao("N1")).toBeNull();
		expect(normalizarCoordenacao("")).toBeNull();
	});
});

describe("mapearContratos", () => {
	const gestao = (): Gestao => ({
		id: "23/24",
		anoInicio: 2023,
		ciclos: [{ id: "c", rotulo: "C", mesInicio: "10", mesFim: "09" }],
		contratos: fonteDeTeste(),
	});

	const linha = (valores: Record<string, string>) => ({
		valores,
		linhaPlanilha: 2,
		origemRef: "PLANILHA#Contratos#L2",
	});

	it("mapeia contrato completo para a linha do banco", () => {
		const { projetos } = mapearContratos(gestao(), [
			linha({
				mes: "outubro/2023",
				projeto: "DI Padaria Alfa",
				coordenacao: "ACE",
				valorVendidoReal: "R$ 3.500,00",
				valorContrato: "R$ 3.600,00",
				canalAquisicao: "Indicação UFRJ",
				responsavel1: "Pedro",
				responsavel2: "",
			}),
		] as never);

		expect(projetos).toHaveLength(1);
		expect(projetos[0].linha).toMatchObject({
			mes_venda: "2023-10-01",
			nome_projeto: "DI Padaria Alfa",
			coordenacao: "ACE",
			valor_vendido_real: 3500,
			valor_contrato: 3600,
			gestao: "23/24",
		});
		expect(projetos[0].responsaveis).toEqual(["Pedro"]);
	});

	it("contrato sem valor entra com zero — L84 de 23/24", () => {
		const { projetos } = mapearContratos(gestao(), [
			linha({ mes: "julho/2024", projeto: "Acompanhamento", coordenacao: "MNP" }),
		] as never);
		expect(projetos[0].linha.valor_vendido_real).toBe(0);
		expect(projetos[0].linha.mes_venda).toBe("2024-07-01");
	});

	it("rejeita coordenação fora do padrão em vez de convertê-la", () => {
		const { projetos, rejeitados } = mapearContratos(gestao(), [
			linha({ mes: "outubro/2023", projeto: "X", coordenacao: "N1" }),
		] as never);
		expect(projetos).toHaveLength(0);
		expect(rejeitados[0].motivo).toMatch(/coordenação fora do padrão/);
	});

	it("em 23/24 deriva fidelização do canal, que é onde a gestão a registrava", () => {
		const { projetos } = mapearContratos(gestao(), [
			linha({
				mes: "outubro/2023",
				projeto: "X",
				coordenacao: "ACE",
				canalAquisicao: "Fidelização",
			}),
		] as never);
		expect(projetos[0].linha.fidelizacao).toBe(true);
	});

	it("quando existe coluna própria, ela manda", () => {
		const { projetos } = mapearContratos(gestao(), [
			linha({
				mes: "outubro/2023",
				projeto: "X",
				coordenacao: "ACE",
				canalAquisicao: "Fidelização",
				fidelizacao: "Não",
			}),
		] as never);
		expect(projetos[0].linha.fidelizacao).toBe(false);
	});
})

// ─── Reconciliação ────────────────────────────────────────────────

describe("acharOrfaos", () => {
	const noBanco = [
		{ id: 1, nome: "DI Padaria Alfa" },
		{ id: 2, nome: "EV Fazenda Beta" },
		{ id: 3, nome: "PN Rede Gama" },
	];
	const chave = (p: { nome: string }) =>
		chaveProjeto({ nome_projeto: p.nome, coordenacao: "CCE", mes_venda: "2025-10-01" });
	const lida = (nome: string) => chave({ nome });

	it("acha o que está no banco e sumiu da planilha", () => {
		const lidas = new Set([lida("DI Padaria Alfa"), lida("PN Rede Gama")]);
		expect(acharOrfaos(noBanco, chave, lidas).map((p) => p.id)).toEqual([2]);
	});

	it("projeto renomeado deixa a versão antiga órfã", () => {
		// Sem isto, renomear insere a nova e mantém a antiga: contrato contado duas vezes.
		const lidas = new Set([lida("DI Padaria Alfa Silva"), lida("EV Fazenda Beta"), lida("PN Rede Gama")]);
		expect(acharOrfaos(noBanco, chave, lidas).map((p) => p.nome)).toEqual([
			"DI Padaria Alfa",
		]);
	});

	it("nada órfão quando a planilha traz tudo", () => {
		const lidas = new Set([lida("DI Padaria Alfa"), lida("EV Fazenda Beta"), lida("PN Rede Gama")]);
		expect(acharOrfaos(noBanco, chave, lidas)).toEqual([]);
	});

	it("ignora diferença de espaço em volta do nome", () => {
		const lidas = new Set([lida("DI Padaria Alfa"), lida("EV Fazenda Beta"), lida("PN Rede Gama")]);
		const comEspaco = [{ id: 9, nome: "  DI Padaria Alfa  " }];
		expect(acharOrfaos(comEspaco, chave, lidas)).toEqual([]);
	});
});

describe("chaveMeta", () => {
	it("distingue coordenação de meta geral", () => {
		expect(chaveMeta("ciclo", "waterloo", "ACE")).not.toBe(
			chaveMeta("ciclo", "waterloo", null),
		);
	});

	it("é estável para a mesma meta — correção de valor não vira órfã", () => {
		// A chave não inclui o valor: mudar a meta de 300.000 para 320.000 atualiza
		// a linha existente em vez de criar outra e deixar a antiga.
		expect(chaveMeta("ciclo", "waterloo", null)).toBe(
			chaveMeta("ciclo", "waterloo", null),
		);
	});
})

describe("normalizarNomeVendedor", () => {
	it("capitaliza cada palavra", () => {
		expect(normalizarNomeVendedor("ana souza lima")).toBe(
			"Ana Souza Lima",
		);
	});

	it("NÃO quebra nome acentuado — o bug dos 27 vendedores", () => {
		// `\b\w` maiusculizava a letra depois do acento: "JoãO", "GonçAlves".
		expect(normalizarNomeVendedor("joão carlos pereira")).toBe(
			"João Carlos Pereira",
		);
		expect(normalizarNomeVendedor("paula ribeiro gonçalves")).toBe(
			"Paula Ribeiro Gonçalves",
		);
		expect(normalizarNomeVendedor("MARCOS LIMA ARAÚJO")).toBe(
			"Marcos Lima Araújo",
		);
	});

	it("colapsa espaço extra e aparas", () => {
		expect(normalizarNomeVendedor("  luísa   ferreira  ")).toBe("Luísa Ferreira");
	});
})

describe("chaveProjeto", () => {
	const id = (nome_projeto: string, coordenacao: string, mes_venda: string) =>
		chaveProjeto({ nome_projeto, coordenacao, mes_venda });

	it("mesmo nome em coordenações diferentes são contratos distintos — Café Zeta PRO e QAB", () => {
		expect(id("Café Zeta", "PRO", "2026-09-01")).not.toBe(
			id("Café Zeta", "QAB", "2026-09-01"),
		);
	});

	it("mesmo nome em meses diferentes são contratos distintos — PE Projeto Lambda dez e set", () => {
		expect(id("PE Projeto Lambda", "PRO", "2025-12-01")).not.toBe(
			id("PE Projeto Lambda", "PRO", "2026-09-01"),
		);
	});

	it("espaço em volta do nome não cria um contrato novo", () => {
		expect(id("  DI Padaria Alfa ", "CCE", "2025-10-01")).toBe(
			id("DI Padaria Alfa", "CCE", "2025-10-01"),
		);
	});

	it("leitura de homônimos não perde nenhuma linha: 4 linhas, 4 identidades", () => {
		const grade = [
			...GRADE,
			["setembro/2026", "Café Zeta", "PRO"],
			["setembro/2026", "Café Zeta", "QAB"],
		];
		const t = lerTabela("23/24", fonteDeTeste(), grade);
		const { projetos } = mapearContratos(buscarGestao("23/24"), t.linhas);
		const cafe = projetos.filter((p) => p.linha.nome_projeto === "Café Zeta");
		expect(new Set(cafe.map((p) => chaveProjeto(p.linha))).size).toBe(2);
	});
});
