// src/lib/fontes/sheets-fonte.ts
//
// Ponte entre o registry e a API do Google Sheets. É a única camada aqui que
// faz rede — `tabela.ts` continua puro e testável com grades em memória.

import { google } from "googleapis";

import { lerTabela } from "./tabela";
import { lerMetas, type MetaIlegivel, type MetasLidas } from "./blocos";
import { lerGradeFaturamento, type FaturamentoLido } from "./faturamento";
import { lerProjetos, type ProjetosLidos } from "./entregas";
import type { FonteEntregas, Gestao, TabelaLida } from "./tipos";

function clienteSheets() {
	const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
	const chave = process.env.GOOGLE_PRIVATE_KEY;

	if (!email || !chave) {
		throw new Error(
			"GOOGLE_SERVICE_ACCOUNT_EMAIL e GOOGLE_PRIVATE_KEY são obrigatórios no ambiente.",
		);
	}

	const auth = new google.auth.GoogleAuth({
		credentials: { client_email: email, private_key: chave.replace(/\\n/g, "\n") },
		// Somente leitura: esta credencial não consegue escrever nem que alguém a
		// promova a Editor na planilha.
		scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
	});

	return google.sheets({ version: "v4", auth });
}

/** Nome de aba dentro de um range A1 precisa de aspas simples; internas dobram. */
function rangeAba(nome: string): string {
	return `'${nome.replace(/'/g, "''")}'`;
}

/**
 * Lê a aba de contratos de uma gestão e devolve as linhas já mapeadas para os
 * campos canônicos, com linhagem.
 *
 * Lança `ErroLeituraPlanilha` se um campo obrigatório não for encontrado — é o
 * comportamento desejado: melhor não ingerir do que ingerir deslocado.
 */
export async function lerContratos(gestao: Gestao): Promise<TabelaLida> {
	const fonte = gestao.contratos;
	const sheets = clienteSheets();

	const resposta = await sheets.spreadsheets.values.get({
		spreadsheetId: fonte.spreadsheetId,
		range: rangeAba(fonte.aba),
		// FORMATTED_VALUE devolve o que a planilha exibe ("R$ 1.234,56",
		// "01/10/2025"), que é o que os parsers de valor e data esperam.
		valueRenderOption: "FORMATTED_VALUE",
	});

	const grade = (resposta.data.values as string[][]) ?? [];
	return lerTabela(gestao.id, fonte, grade);
}

/**
 * Lê o painel de metas de uma gestão. Devolve as metas reconhecidas, o que ficou
 * ilegível (com motivo) e avisos sobre a fonte.
 */
export async function lerMetasDaGestao(gestao: Gestao): Promise<MetasLidas> {
	if (!gestao.metas) {
		return {
			gestao: gestao.id,
			metas: [],
			ilegiveis: [],
			avisos: ["sem fonte de metas no registry"],
			notas: [],
		};
	}

	const sheets = clienteSheets();
	const resposta = await sheets.spreadsheets.values.get({
		spreadsheetId: gestao.metas.spreadsheetId,
		range: rangeAba(gestao.metas.aba),
		valueRenderOption: "FORMATTED_VALUE",
	});

	return lerMetas(gestao, (resposta.data.values as string[][]) ?? []);
}

export interface FaturamentoDaGestao {
	meses: FaturamentoLido[];
	metas: MetasLidas;
	ilegiveis: MetaIlegivel[];
	avisos: string[];
}

/**
 * Lê o faturamento e as metas de faturamento de uma gestão. Uma requisição só
 * (batchGet) para as seis abas e a de metas: a cota do Sheets é por minuto, e o
 * sync já lê contratos e metas de vendas na mesma rodada.
 */
export async function lerFaturamentoDaGestao(gestao: Gestao): Promise<FaturamentoDaGestao | null> {
	const fonte = gestao.faturamento;
	if (!fonte) return null;

	const abas = [...fonte.abas.map((a) => a.aba), fonte.metas.aba];
	const resposta = await clienteSheets().spreadsheets.values.batchGet({
		spreadsheetId: fonte.spreadsheetId,
		ranges: abas.map(rangeAba),
		valueRenderOption: "FORMATTED_VALUE",
	});
	const grades = (resposta.data.valueRanges ?? []).map((v) => (v.values as string[][]) ?? []);

	const meses: FaturamentoLido[] = [];
	const ilegiveis: MetaIlegivel[] = [];
	const avisos: string[] = [];
	fonte.abas.forEach(({ aba, coordenacao }, i) => {
		const lida = lerGradeFaturamento(gestao, fonte.spreadsheetId, aba, coordenacao, grades[i] ?? []);
		meses.push(...lida.meses);
		ilegiveis.push(...lida.ilegiveis);
		avisos.push(...lida.avisos);
	});

	// A aba de metas de faturamento tem o layout da de vendas: o mesmo leitor serve.
	const metas = lerMetas({ ...gestao, metas: fonte.metas }, grades[fonte.abas.length] ?? []);
	return { meses, metas, ilegiveis, avisos };
}

/** As duas abas da planilha de projetos numa requisição (batchGet). */
export async function lerEntregas(fonte: FonteEntregas): Promise<ProjetosLidos[]> {
	const resposta = await clienteSheets().spreadsheets.values.batchGet({
		spreadsheetId: fonte.spreadsheetId,
		ranges: [rangeAba(fonte.abaEntregues), rangeAba(fonte.abaEmExecucao)],
		valueRenderOption: "FORMATTED_VALUE",
	});
	const [entregues, atual] = (resposta.data.valueRanges ?? []).map((v) => (v.values as string[][]) ?? []);
	return [
		lerProjetos("entregue", fonte.spreadsheetId, fonte.abaEntregues, entregues ?? []),
		lerProjetos("em_execucao", fonte.spreadsheetId, fonte.abaEmExecucao, atual ?? []),
	];
}
