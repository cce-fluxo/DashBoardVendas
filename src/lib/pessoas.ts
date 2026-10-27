// src/lib/pessoas.ts
//
// Grafia de responsável → pessoa (migration 0011).
//
// O banco guarda o nome como a fonte escreveu: "Jonas" em 23/24, "Jonas Pimenta
// Thé" em 25/26. Sem isto, um ranking que atravessa gestões conta a mesma pessoa
// duas vezes, cada metade num lugar do pódio. A resolução acontece NA LEITURA
// para que corrigir `pessoa_grafia` valha na hora — as planilhas passadas não
// mudam, então reprocessá-las não consertaria nada.
//
// Grafia sem pessoa continua sendo ela mesma (o comportamento de antes). Nada
// some: a Auditoria lista o que falta ligar.

import { createClient } from "@supabase/supabase-js";

import { valorDoResponsavel } from "@/lib/calculations";
import { normalizarNomeVendedor } from "@/lib/fontes/mapear";

export interface GrafiaPessoa {
	grafia: string;
	/** null = vale em qualquer gestão. */
	gestao: string | null;
	idPessoa: number;
	nomeExibicao: string;
	/** pessoa.foto_url (migration 0013). */
	fotoUrl?: string | null;
}

export type ResolverPessoa = (nome: string, gestao: string | null) => string;

/**
 * Procura (grafia, gestão) antes de (grafia, qualquer gestão): é o que separa
 * dois "Rafa" de gestões diferentes.
 *
 * ponytail: uma grafia com gestão NULL vale também para o Pipefy, que não tem
 * gestão. Se o mesmo nome for duas pessoas entre Pipefy e planilha, elas se
 * fundem; a saída é cadastrar a grafia com gestão.
 */
function criarBusca(
	grafias: GrafiaPessoa[],
): (nome: string, gestao: string | null) => string | undefined {
	const mapa = new Map<string, string>();
	for (const g of grafias) {
		mapa.set(`${normalizarNomeVendedor(g.grafia)}|${g.gestao ?? ""}`, g.nomeExibicao);
	}
	return (nome, gestao) => {
		const n = normalizarNomeVendedor(nome);
		return (
			(gestao !== null ? mapa.get(`${n}|${gestao}`) : undefined) ??
			mapa.get(`${n}|`)
		);
	};
}

export function criarResolvedor(grafias: GrafiaPessoa[]): ResolverPessoa {
	const buscar = criarBusca(grafias);
	return (nome, gestao) => buscar(nome, gestao) ?? nome;
}

/** "Agatha Frossard" → "AF"; "Jonas" → "JO". */
export function iniciais(nome: string): string {
	const partes = nome.trim().split(/\s+/).filter(Boolean);
	if (partes.length === 0) return "";
	if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
	return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export interface GrafiaSemPessoa {
	grafia: string;
	gestoes: string[];
	contratos: number;
	valor: number;
}

/**
 * Grafias de contratos que não resolvem para nenhuma pessoa — o quanto do
 * ranking histórico ainda está fragmentado. `vendas` precisa vir CRUA
 * (`buscarVendasDoBanco({ crus: true })`); resolvida, não sobraria grafia.
 */
export function grafiasSemPessoa(
	vendas: {
		gestao: string;
		valorContrato: number;
		valorVendidoReal: number;
		responsavel1?: string;
		responsavel2?: string;
		responsavel3?: string;
		responsavel4?: string;
	}[],
	grafias: GrafiaPessoa[],
): GrafiaSemPessoa[] {
	const buscar = criarBusca(grafias);
	const mapa = new Map<string, GrafiaSemPessoa>();
	for (const v of vendas) {
		for (const nome of [v.responsavel1, v.responsavel2, v.responsavel3, v.responsavel4]) {
			if (!nome || buscar(nome, v.gestao) !== undefined) continue;
			const g = mapa.get(nome) ?? { grafia: nome, gestoes: [], contratos: 0, valor: 0 };
			if (!g.gestoes.includes(v.gestao)) g.gestoes.push(v.gestao);
			g.contratos += 1;
			// Mesma coluna do ranking (calcularKPIsPorVendedor).
			g.valor += valorDoResponsavel(v);
			mapa.set(nome, g);
		}
	}
	return [...mapa.values()].sort((a, b) => b.valor - a.valor);
}

const PAGINA = 1000;

/**
 * Toda a base de grafias. Erro de leitura devolve lista vazia — o ranking cai no
 * comportamento de antes (uma linha por grafia), não quebra a tela.
 */
export async function buscarGrafias(): Promise<GrafiaPessoa[]> {
	const supabase = createClient(
		process.env.SUPABASE_URL!,
		process.env.SUPABASE_SERVICE_ROLE_KEY!,
	);
	const todas: GrafiaPessoa[] = [];
	for (let inicio = 0; ; inicio += PAGINA) {
		const { data, error } = await supabase
			.from("pessoa_grafia")
			.select("grafia, gestao, id_pessoa, pessoa ( nome_exibicao, foto_url )")
			.order("id_grafia", { ascending: true })
			.range(inicio, inicio + PAGINA - 1);

		if (error) {
			console.error("[Pessoas] Erro ao buscar grafias:", error.message);
			return [];
		}
		const lote = (data ?? []) as unknown as {
			grafia: string;
			gestao: string | null;
			id_pessoa: number;
			pessoa: { nome_exibicao: string; foto_url: string | null } | null;
		}[];
		for (const l of lote) {
			if (!l.pessoa) continue;
			todas.push({
				grafia: l.grafia,
				gestao: l.gestao,
				idPessoa: l.id_pessoa,
				nomeExibicao: l.pessoa.nome_exibicao,
				fotoUrl: l.pessoa.foto_url,
			});
		}
		if (lote.length < PAGINA) break;
	}
	return todas;
}
