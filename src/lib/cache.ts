// src/lib/cache.ts
//
// Cache das respostas das rotas de leitura (/api/dashboard*).
//
// POR QUE EXISTE
//
// Os dados só mudam quando uma sincronização roda — o cron a cada 30 minutos,
// o botão Atualizar ou um backfill. Mesmo assim, cada abertura de tela relia o
// banco inteiro: ~3 mil cards com histórico (1,5 MB) e todas as vendas, em
// cerca de 10 consultas. Eram 0,7–0,9 s por rota mesmo com as funções na mesma
// região do banco, e a Visão geral chama duas rotas.
//
// O QUE É GUARDADO
//
// A RESPOSTA PRONTA de cada rota, separada pelos parâmetros (período,
// coordenações, etapas). Não os dados crus: os cards passam de 1,5 MB e
// crescem a cada gestão, perto do limite de um item de cache. As respostas têm
// de 5 a 25 KB.
//
// A idade do dado (`medirFrescor`) fica FORA do cache, calculada a cada
// requisição. Guardada, ela congelaria — e é justamente o alarme de que o
// agendador parou.
//
// POR QUE `unstable_cache` E NÃO `'use cache'`
//
// `'use cache'` exige ligar o modo Cache Components, que muda o modelo de
// renderização do app inteiro. E o armazenamento padrão dele é em memória, que
// numa função serverless não sobrevive entre requisições. `unstable_cache` é o
// caminho documentado para projetos sem esse modo e persiste no cache da
// plataforma. Ver node_modules/next/dist/docs/01-app/02-guides/
// caching-without-cache-components.md.
//
// COMO É INVALIDADO
//
// `invalidarDados()` ao fim de toda sincronização: /api/cron/pipefy,
// /api/cron/sheets e /api/dashboard/atualizar. Scripts que escrevem no banco
// (backfill, congelar-periodos) rodam fora do Next e não conseguem invalidar;
// para eles vale a validade máxima abaixo — ou um clique em Atualizar, que
// sempre invalida.

import { revalidateTag, unstable_cache } from "next/cache";

export const TAG_DADOS = "dados-do-banco";

/**
 * Validade máxima de uma resposta guardada, em segundos.
 *
 * Rede de segurança, não o mecanismo principal: com o cron a cada 30 minutos,
 * a invalidação chega antes. Ela vale para o que escreve no banco sem passar
 * pelo Next e para valores que dependem da data de hoje (período em andamento,
 * meses decorridos).
 */
const VALIDADE_MAXIMA_SEGUNDOS = 1800;

/** Uma leitura do banco voltou vazia — quase sempre erro, nunca resposta. */
export class LeituraVazia extends Error {
	constructor(fonte: string) {
		super(`A leitura de "${fonte}" no banco voltou vazia.`);
		this.name = "LeituraVazia";
	}
}

/**
 * Falha se alguma das listas lidas do banco estiver vazia.
 *
 * As funções de leitura devolvem [] quando a consulta falha. Sem cache, isso
 * mostrava zeros por uma requisição; COM cache, os zeros ficariam guardados por
 * até meia hora. Lançar aqui impede o cache de guardar, e a rota responde 503
 * — a tela mostra erro em vez de um número falso. Nenhuma destas tabelas fica
 * vazia em operação normal.
 */
export function exigirLeitura(listas: Record<string, readonly unknown[]>): void {
	for (const [fonte, lista] of Object.entries(listas)) {
		if (lista.length === 0) throw new LeituraVazia(fonte);
	}
}

/** Envolve o cálculo de uma rota no cache, com a tag que a sincronização invalida. */
export function cacheado<A extends unknown[], R>(
	nome: string,
	calcular: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
	return unstable_cache(calcular, [nome], {
		tags: [TAG_DADOS],
		revalidate: VALIDADE_MAXIMA_SEGUNDOS,
	});
}

/**
 * Descarta todas as respostas guardadas.
 *
 * `expire: 0` e não o perfil "max": depois de uma sincronização, a próxima
 * requisição precisa ver o dado novo, não o anterior enquanto o novo é
 * calculado — quem clica em Atualizar quer ver o efeito do clique.
 */
export function invalidarDados(): void {
	revalidateTag(TAG_DADOS, { expire: 0 });
}

/**
 * O erro é uma leitura vazia?
 *
 * Pelo nome, não só por `instanceof`: o erro atravessa o `unstable_cache`, e
 * nada garante que volte como a mesma instância de classe.
 */
export function ehLeituraVazia(erro: unknown): erro is Error {
	return (
		erro instanceof LeituraVazia ||
		(erro instanceof Error && erro.name === "LeituraVazia")
	);
}

/** Resposta padrão das rotas de leitura quando o banco não respondeu. */
export function respostaLeituraVazia(erro: Error): Response {
	console.error("[Cache]", erro.message);
	return Response.json(
		{ message: "O banco não respondeu agora. Tente de novo em instantes." },
		{ status: 503 },
	);
}
