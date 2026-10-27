// src/lib/fontes/mapear.ts
//
// Traduz o que foi lido das planilhas (campos canônicos, tudo string) para as
// linhas que o banco espera. Puro e sem rede — os testes rodam sem Supabase.

import { normalizarCabecalho } from "./normalizar";
import type { MetaLida } from "./blocos";
import type { CampoContrato, Gestao, LinhaTabela } from "./tipos";

export const COORDENACOES_VALIDAS = ["CCE", "ACE", "MNP", "QAB", "PRO"] as const;
export type CoordenacaoValida = (typeof COORDENACOES_VALIDAS)[number];

const MESES_PT: Record<string, number> = {
	janeiro: 1,
	fevereiro: 2,
	marco: 3,
	abril: 4,
	maio: 5,
	junho: 6,
	julho: 7,
	agosto: 8,
	setembro: 9,
	outubro: 10,
	novembro: 11,
	dezembro: 12,
};

// ─── Parsers ──────────────────────────────────────────────────────

/** "R$ 1.234,56" → 1234.56. Vazio ou ilegível → 0. */
export function parsearValorBR(bruto: string | undefined): number {
	const s = (bruto ?? "").trim();
	if (!s) return 0;
	const limpo = s
		.replace(/R\$\s?/gi, "")
		.replace(/\s/g, "")
		.replace(/\./g, "")
		.replace(",", ".");
	const n = parseFloat(limpo);
	return Number.isFinite(n) ? n : 0;
}

/** "Sim" → true; qualquer outra coisa → false. */
export function parsearSimNao(bruto: string | undefined): boolean {
	return normalizarCabecalho(bruto ?? "") === "sim";
}

/** Devolve a coordenação se for uma das cinco; caso contrário null. */
export function normalizarCoordenacao(
	bruto: string | undefined,
): CoordenacaoValida | null {
	const s = (bruto ?? "").trim().toUpperCase();
	return (COORDENACOES_VALIDAS as readonly string[]).includes(s)
		? (s as CoordenacaoValida)
		: null;
}

/**
 * Rótulo de mês da planilha → primeiro dia do mês, no ano correto da gestão.
 *
 * O ANO DO RÓTULO É IGNORADO. A gestão vai de outubro a setembro, então o ano
 * sai de `anoInicio`: meses 10–12 no primeiro ano, 01–09 no segundo. Confiar no
 * rótulo seria frágil — na planilha de 25/26 eles ficaram do ano anterior.
 *
 * Devolve null se o rótulo não nomear um mês.
 */
export function mesParaData(
	rotulo: string | undefined,
	anoInicio: number,
): string | null {
	const nome = normalizarCabecalho(rotulo ?? "").split("/")[0]?.trim();
	const mm = MESES_PT[nome];
	if (!mm) return null;
	const ano = mm >= 10 ? anoInicio : anoInicio + 1;
	return `${ano}-${String(mm).padStart(2, "0")}-01`;
}

/**
 * "05/10/2026" → "2026-10-05". Vazio → null sem erro; ilegível → null com erro.
 *
 * "30/12/1899" é o dia zero do Sheets: o que uma célula de data VAZIA com
 * fórmula devolve. Tratar como data colocaria o contrato em 1899.
 */
export function parsearDataBR(
	bruto: string | undefined,
): { data: string | null; erro?: string } {
	const s = (bruto ?? "").trim();
	if (!s || s === "30/12/1899") return { data: null };
	const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
	if (m) {
		const [dd, mm, aaaa] = [Number(m[1]), Number(m[2]), Number(m[3])];
		const d = new Date(Date.UTC(aaaa, mm - 1, dd));
		// Date aceita 31/02 e rola para março; a volta confere que o dia existe.
		if (d.getUTCDate() === dd && d.getUTCMonth() === mm - 1) {
			return {
				data: `${aaaa}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`,
			};
		}
	}
	return { data: null, erro: `data ilegível: "${s}"` };
}

// ─── Contratos ────────────────────────────────────────────────────

export interface LinhaProjeto {
	mes_venda: string;
	nome_projeto: string;
	assinado: boolean;
	coordenacao: CoordenacaoValida;
	valor_contrato: number;
	valor_vendido_real: number;
	canal_aquisicao: string | null;
	fidelizacao: boolean;
	gestao: string;
	contratante: string | null;
	data_assinatura: string | null;
	item_da_carta: string | null;
}

export interface ProjetoMapeado {
	linha: LinhaProjeto;
	responsaveis: string[];
	origemRef: string;
	/**
	 * Campo opcional que não pôde ser lido. O contrato ENTRA (com o campo nulo),
	 * mas o motivo precisa ir para `ingestao_rejeicao` — nenhum descarte calado.
	 */
	camposPerdidos: string[];
}

export interface ContratoRejeitado {
	origemRef: string;
	motivo: string;
	valores: Partial<Record<CampoContrato, string>>;
}

/**
 * Fidelização.
 *
 * 24/25 e 25/26 têm coluna própria. 23/24 não tem: naquela gestão, "Fidelização"
 * é um dos valores de "Canal de aquisição". Ler o canal é leitura fiel da fonte,
 * não invenção — mas é uma normalização entre gestões que vale conferir.
 */
function inferirFidelizacao(v: Partial<Record<CampoContrato, string>>): boolean {
	if (v.fidelizacao !== undefined) return parsearSimNao(v.fidelizacao);
	return normalizarCabecalho(v.canalAquisicao ?? "") === "fidelizacao";
}

export function mapearContratos(
	gestao: Gestao,
	linhas: LinhaTabela[],
): { projetos: ProjetoMapeado[]; rejeitados: ContratoRejeitado[] } {
	const projetos: ProjetoMapeado[] = [];
	const rejeitados: ContratoRejeitado[] = [];

	for (const l of linhas) {
		const v = l.valores;

		const mesVenda = mesParaData(v.mes, gestao.anoInicio);
		if (!mesVenda) {
			rejeitados.push({
				origemRef: l.origemRef,
				motivo: `mês não reconhecido: "${v.mes ?? ""}"`,
				valores: v,
			});
			continue;
		}

		// Sem fallback para "CCE": coordenação fora do padrão vira rejeição.
		// O parser antigo (sheets.ts:89) convertia silenciosamente, inflando o CCE.
		const coordenacao = normalizarCoordenacao(v.coordenacao);
		if (!coordenacao) {
			rejeitados.push({
				origemRef: l.origemRef,
				motivo: `coordenação fora do padrão: "${v.coordenacao ?? ""}"`,
				valores: v,
			});
			continue;
		}

		const responsaveis = [
			v.responsavel1,
			v.responsavel2,
			v.responsavel3,
			v.responsavel4,
		]
			.map((r) => (r ?? "").trim())
			.filter(Boolean);

		const assinatura = parsearDataBR(v.dataAssinatura);

		projetos.push({
			origemRef: l.origemRef,
			responsaveis,
			camposPerdidos: assinatura.erro
				? [`data de assinatura descartada — ${assinatura.erro}`]
				: [],
			linha: {
				mes_venda: mesVenda,
				nome_projeto: (v.projeto ?? "").trim(),
				// A aba "Contratos" só contém assinados; quando a coluna existe ela
				// vale "Sim" em todas as linhas. Ausente, assumimos assinado.
				assinado: v.assinado === undefined ? true : parsearSimNao(v.assinado),
				coordenacao,
				valor_contrato: parsearValorBR(v.valorContrato),
				valor_vendido_real: parsearValorBR(v.valorVendidoReal),
				canal_aquisicao: (v.canalAquisicao ?? "").trim() || null,
				fidelizacao: inferirFidelizacao(v),
				gestao: gestao.id,
				contratante: (v.contratante ?? "").trim() || null,
				data_assinatura: assinatura.data,
				item_da_carta: (v.itemDaCarta ?? "").trim() || null,
			},
		});
	}

	return { projetos, rejeitados };
}

// ─── Metas ────────────────────────────────────────────────────────

export interface LinhaMeta {
	valor_meta: number;
	tipo_meta: "gestao" | "ciclo" | "mes";
	gestao_meta: string;
	coordenacao: CoordenacaoValida | null;
	periodo: string;
}

export interface MetaMapeada {
	linha: LinhaMeta;
	origemRef: string;
	derivada: boolean;
}

export function mapearMetas(gestao: Gestao, metas: MetaLida[]): MetaMapeada[] {
	return metas.map((m) => ({
		origemRef: m.origemRef,
		derivada: m.derivada === true,
		linha: {
			valor_meta: m.valor,
			tipo_meta: m.tipo,
			gestao_meta: gestao.id,
			coordenacao: normalizarCoordenacao(m.coordenacao ?? undefined),
			periodo: m.periodo,
		},
	}));
}

// ─── Reconciliação ────────────────────────────────────────────────
//
// O upsert sozinho só faz o banco GANHAR linhas. Ele não percebe que uma linha
// sumiu da planilha, nem que um projeto foi renomeado — renomear insere a nova e
// deixa a antiga, e o dashboard passa a contar as duas.
//
// A reconciliação fecha isso: o que está no banco para aquela gestão e não
// apareceu na leitura atual foi removido da fonte, e precisa sair.

/**
 * Identidade de um contrato dentro da gestão: nome + coordenação + mês.
 *
 * Era só o nome. Mas o nome NÃO identifica um contrato: "Café Zeta" é vendido
 * por duas coordenações (PRO e QAB, valores diferentes) e "PE Projeto Lambda" tem um
 * contrato de dezembro e outro de setembro. Com o nome como chave, os homônimos
 * colidiam no upsert, o último vencia e o outro sumia do banco — em 25/26, 83
 * contratos na planilha viravam 81, e o valor de dois contratos desaparecia dos
 * totais sem erro nenhum.
 *
 * Tem de coincidir com `uq_projeto_identidade` (migration 0010).
 */
export function chaveProjeto(p: {
	nome_projeto: string;
	coordenacao: string;
	mes_venda: string;
}): string {
	return `${p.nome_projeto.trim()}|${p.coordenacao}|${p.mes_venda}`;
}

/** Chave natural de uma meta — a mesma de `meta_unique_idx`, sem a gestão. */
export function chaveMeta(
	tipo: string,
	periodo: string,
	coordenacao: string | null,
): string {
	return `${tipo}|${periodo}|${coordenacao ?? "GERAL"}`;
}

/**
 * O que existe no banco e não veio na leitura — ou seja, sumiu da planilha.
 *
 * Puro de propósito: a decisão de apagar dado merece teste, e teste que precisa
 * de banco não roda.
 */
export function acharOrfaos<T>(
	noBanco: T[],
	chaveDe: (item: T) => string,
	chavesLidas: Set<string>,
): T[] {
	return noBanco.filter((item) => !chavesLidas.has(chaveDe(item)));
}

/**
 * Normaliza nome de vendedor: trim + capitaliza cada palavra.
 *
 * Não use `\b\w` aqui. `\w` é `[A-Za-z0-9_]`, então letra acentuada não conta
 * como caractere de palavra e a letra SEGUINTE cai numa fronteira: "joão"
 * virava "JoãO" e "gonçalves" virava "GonçAlves". Havia 27 vendedores assim.
 */
export function normalizarNomeVendedor(nome: string): string {
	return nome
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
		.join(" ");
}
