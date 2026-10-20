// src/lib/supabase-vendas.ts
//
// Leitura de vendas e metas a partir do Supabase.
//
// Substitui `src/lib/sheets.ts` no caminho de request. Antes disso,
// `/api/dashboard` chamava o Google Sheets a CADA requisição — quatro chamadas
// por request, com cache de 5 minutos. Três consequências que isso tinha:
//
//   1. As tabelas `projeto_vendido` e `meta` eram escritas e nunca lidas. O
//      banco não era fonte de nada.
//   2. A cota de leitura do Sheets é por minuto e por usuário. Numa varredura de
//      35 requisições espaçadas em 1,5s, 17% voltaram HTTP 500. Bastam algumas
//      pessoas navegando ao mesmo tempo para derrubar a tela.
//   3. Snapshot de período fechado (F7) seria decorativo enquanto a tela lesse a
//      planilha ao vivo.
//
// As funções devolvem `Venda[]` e `MetaPeriodo[]` — as mesmas formas que
// `calculations.ts` já consome, de propósito: a troca de fonte não deveria
// exigir reescrever o motor de cálculo.

import { createClient } from "@supabase/supabase-js";

import type { Coordenacao, MetaPeriodo, PeriodoGestao, Venda } from "@/types";

function getSupabase() {
	return createClient(
		process.env.SUPABASE_URL!,
		process.env.SUPABASE_SERVICE_ROLE_KEY!,
	);
}

// O Supabase corta a resposta em `max-rows` (padrão 1000). Sem paginar, a base
// truncaria em silêncio assim que passasse disso — foi o que já aconteceu com os
// cards do funil (ver supabase-funil.ts). Hoje são 273 contratos, mas cada
// gestão nova soma ~100.
const PAGINA = 1000;

/**
 * Mês da venda como "01".."12", direto da string da coluna `date`.
 *
 * Sem passar por `new Date()`: a coluna vem como "2024-10-01" e construir um
 * Date a partir disso o interpreta em UTC, que no fuso de Brasília pode recuar
 * para o dia 30 do mês anterior e trocar o mês da venda.
 */
function mesDaData(mesVenda: string): string {
	return (mesVenda ?? "").split("-")[1] ?? "";
}

interface LinhaProjeto {
	nome_projeto: string;
	mes_venda: string;
	assinado: boolean;
	coordenacao: string;
	valor_contrato: number | null;
	valor_vendido_real: number | null;
	canal_aquisicao: string | null;
	fidelizacao: boolean;
	gestao: string;
	origem_ref: string | null;
	projeto_vendedor?: { vendedor?: { nome_vendedor?: string } | null }[] | null;
}

function paraVenda(row: LinhaProjeto): Venda {
	const responsaveis = (row.projeto_vendedor ?? [])
		.map((pv) => pv?.vendedor?.nome_vendedor)
		.filter((n): n is string => Boolean(n));

	return {
		gestao: row.gestao as PeriodoGestao,
		origemRef: row.origem_ref ?? undefined,
		mes: mesDaData(row.mes_venda),
		projetoAssinado: row.nome_projeto,
		assinado: row.assinado,
		coordenacao: row.coordenacao as Coordenacao,
		// Contrato assinado sem valor na planilha entra como 0 — decisão do dono
		// do processo. `null` no banco só ocorre em linha anterior à migration.
		valorVendidoReal: row.valor_vendido_real ?? 0,
		valorContrato: row.valor_contrato ?? 0,
		canalDeAquisicao: row.canal_aquisicao ?? "",
		fidelizacao: row.fidelizacao,
		// Campos que a planilha tem mas o banco ainda não guarda. Não são usados
		// por nenhum cálculo; ficam com valor neutro em vez de mentir.
		itemDaCarta: "",
		prazo: 0,
		valorContratoParcelas: row.valor_contrato ?? 0,
		precoPorSemana: 0,
		numeroParcelas: 0,
		compiladoNoPortal: false,
		responsavel1: responsaveis[0],
		responsavel2: responsaveis[1],
		responsavel3: responsaveis[2],
		responsavel4: responsaveis[3],
	};
}

/** Todas as vendas de todas as gestões, com os responsáveis já resolvidos. */
export async function buscarVendasDoBanco(): Promise<Venda[]> {
	const supabase = getSupabase();
	const linhas: LinhaProjeto[] = [];
	let inicio = 0;

	for (;;) {
		const { data, error } = await supabase
			.from("projeto_vendido")
			.select(
				`nome_projeto, mes_venda, assinado, coordenacao,
				 valor_contrato, valor_vendido_real, canal_aquisicao,
				 fidelizacao, gestao, origem_ref,
				 projeto_vendedor ( vendedor ( nome_vendedor ) )`,
			)
			// Ordem estável: sem ORDER BY a paginação perde e repete linhas.
			// Ver a nota em supabase-funil.ts.
			.order("id_projeto", { ascending: true })
			.range(inicio, inicio + PAGINA - 1);

		if (error) {
			console.error("[SupabaseVendas] Erro ao buscar vendas:", error.message);
			return [];
		}

		const lote = (data ?? []) as unknown as LinhaProjeto[];
		linhas.push(...lote);

		if (lote.length < PAGINA) break;
		inicio += PAGINA;
	}

	return linhas.map(paraVenda);
}

interface LinhaMeta {
	valor_meta: number;
	tipo_meta: "gestao" | "ciclo" | "mes";
	gestao_meta: string;
	coordenacao: string | null;
	periodo: string;
}

function paraMeta(row: LinhaMeta): MetaPeriodo {
	return {
		gestao: row.gestao_meta as PeriodoGestao,
		// `periodo` guarda o id do ciclo ("waterloo") ou o mês ("01".."12"),
		// conforme `tipo_meta`. Para tipo "gestao", os dois ficam undefined.
		ciclo: row.tipo_meta === "ciclo" ? row.periodo : undefined,
		mes: row.tipo_meta === "mes" ? row.periodo : undefined,
		metaVendas: row.valor_meta,
		coordenacao: (row.coordenacao as Coordenacao | null) ?? null,
	};
}

/** Todas as metas de todas as gestões. */
export async function buscarMetasDoBanco(): Promise<MetaPeriodo[]> {
	const supabase = getSupabase();
	const linhas: LinhaMeta[] = [];
	let inicio = 0;

	for (;;) {
		const { data, error } = await supabase
			.from("meta")
			.select("valor_meta, tipo_meta, gestao_meta, coordenacao, periodo")
			.order("id_meta", { ascending: true })
			.range(inicio, inicio + PAGINA - 1);

		if (error) {
			console.error("[SupabaseVendas] Erro ao buscar metas:", error.message);
			return [];
		}

		const lote = (data ?? []) as LinhaMeta[];
		linhas.push(...lote);

		if (lote.length < PAGINA) break;
		inicio += PAGINA;
	}

	return linhas.map(paraMeta);
}
