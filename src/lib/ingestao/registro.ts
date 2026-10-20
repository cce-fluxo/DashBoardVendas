// src/lib/ingestao/registro.ts
//
// Registro de execução e de rejeições da ingestão.
//
// A regra que este módulo existe para tornar possível:
//
//   Nenhum descarte silencioso. Toda linha que não virou dado grava um motivo
//   legível e o payload cru.
//
// Contador incrementado num `catch` não é registro: some quando o processo
// termina, e ninguém lê o log de um cron. O caso que motivou isto foi o
// `sincronizarMetas`, que falhava em TODA linha por meses sem que nada
// aparecesse — nem na resposta HTTP, nem no workflow, nem em tabela nenhuma.

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
	return createClient(
		process.env.SUPABASE_URL!,
		process.env.SUPABASE_SERVICE_ROLE_KEY!,
	);
}

export type FonteTipo = "sheets" | "pipefy";
export type DisparadoPor = "cron" | "backfill" | "manual";

export interface Rejeicao {
	/** '<spreadsheetId>#<aba>#L42' ou '<pipeId>#<cardId>'. */
	origemRef: string;
	/** Legível por gente, não código de erro. */
	motivo: string;
	campo?: string;
	payload?: unknown;
}

export interface Contagens {
	lidas?: number;
	aceitas?: number;
	ignoradas?: number;
	removidas?: number;
	/**
	 * Quantas LINHAS foram rejeitadas. Por padrão, o número de rejeições
	 * registradas — o que vale para planilha, onde cada rejeição descarta uma
	 * linha inteira.
	 *
	 * No Pipefy não vale: a linha é o CARD, mas a rejeição pode ser de uma
	 * TRANSIÇÃO. Um card gravado inteiro com uma transição descartada gera uma
	 * rejeição sem deixar de ser aceito, e somar os dois é somar cards com
	 * transições. Quem tem essa distinção passa o número explicitamente; as
	 * rejeições em si continuam todas em `ingestao_rejeicao`.
	 */
	rejeitadas?: number;
}

export interface Execucao {
	readonly id: number | null;
	/** Acumula em memória; grava tudo de uma vez em `finalizar`. */
	rejeitar(r: Rejeicao): void;
	rejeitarVarias(rs: Rejeicao[]): void;
	readonly rejeicoes: number;
	finalizar(c: Contagens & { erros?: number }): Promise<void>;
	falhar(erro: unknown): Promise<void>;
}

/**
 * Execução que não escreve nada. Usada em `--simular` e quando a migration 0003
 * ainda não foi aplicada — a ingestão continua funcionando, só sem rastro.
 */
function execucaoInerte(): Execucao {
	const buffer: Rejeicao[] = [];
	return {
		id: null,
		rejeitar: (r) => void buffer.push(r),
		rejeitarVarias: (rs) => void buffer.push(...rs),
		get rejeicoes() {
			return buffer.length;
		},
		finalizar: async () => {},
		falhar: async () => {},
	};
}

/**
 * Fecha execuções que ficaram em "executando" e nunca vão terminar.
 *
 * Um processo morto no meio da carga deixa a linha aberta para sempre: quem
 * escreveria o desfecho era justamente ele. Aconteceu em 11/08/2026 — a rede
 * caiu, `finalizar` não conseguiu gravar, e as execuções #12 e #13 ficaram
 * penduradas. A auditoria acusa, corretamente, mas o ✗ não tem conserto
 * sozinho, e um ✗ eterno ensina a ignorar a lista inteira.
 *
 * Quem varre é a execução SEGUINTE, na abertura: é o momento em que se sabe com
 * certeza que a anterior não vai voltar. Dois critérios:
 *
 *   · MESMA FONTE, parada há mais de 1h — carga completa de pipe leva ~30 min,
 *     e matar uma rodada viva seria bem pior que deixá-la pendurada.
 *   · QUALQUER FONTE, parada há mais de 24h — nenhuma carga legítima dura tanto.
 *     Sem esta segunda regra, a pendência de uma fonte APOSENTADA ficaria para
 *     sempre: quem a encerraria seria a próxima execução dela, que não existe.
 */
async function encerrarPenduradas(fonteRef: string): Promise<void> {
	const supabase = getSupabase();
	const umaHora = new Date(Date.now() - 3600_000).toISOString();
	const umDia = new Date(Date.now() - 24 * 3600_000).toISOString();

	const { data, error } = await supabase
		.from("ingestao_execucao")
		.update({
			status: "falhou",
			terminado_em: new Date().toISOString(),
			erro:
				"Não finalizou: o processo terminou antes de gravar o desfecho " +
				"(queda de rede, kill, deploy). Encerrada pela execução seguinte.",
		})
		.eq("status", "executando")
		.or(
			`and(fonte_ref.eq.${fonteRef},iniciado_em.lt.${umaHora}),iniciado_em.lt.${umDia}`,
		)
		.select("id_execucao");

	if (error) {
		console.warn(`[Ingestão] Não deu para encerrar execuções penduradas: ${error.message}`);
		return;
	}
	if (data && data.length > 0) {
		console.warn(
			`[Ingestão] ${data.length} execução(ões) pendurada(s) encerrada(s) como "falhou": ` +
				data.map((e) => `#${e.id_execucao}`).join(", "),
		);
	}
}

/**
 * Abre uma execução. Se a tabela não existir (migration 0003 não aplicada),
 * devolve uma execução inerte e avisa — a sincronização não deve parar por
 * falta de instrumentação, mas a ausência dela precisa ser dita.
 */
export async function abrirExecucao(params: {
	fonteTipo: FonteTipo;
	fonteRef: string;
	gestao?: string;
	disparadoPor: DisparadoPor;
	simular?: boolean;
}): Promise<Execucao> {
	if (params.simular) return execucaoInerte();

	const supabase = getSupabase();

	await encerrarPenduradas(params.fonteRef);

	const { data, error } = await supabase
		.from("ingestao_execucao")
		.insert({
			fonte_tipo: params.fonteTipo,
			fonte_ref: params.fonteRef,
			gestao: params.gestao ?? null,
			disparado_por: params.disparadoPor,
			status: "executando",
		})
		.select("id_execucao")
		.single();

	if (error || !data) {
		console.warn(
			`[Ingestão] Sem registro de execução: ${error?.message}. ` +
				`A sincronização continua, mas esta rodada não deixa rastro. ` +
				`Aplicou a migration 0003?`,
		);
		return execucaoInerte();
	}

	const id = data.id_execucao as number;
	const buffer: Rejeicao[] = [];

	async function gravarRejeicoes() {
		if (buffer.length === 0) return;

		// Em lote: uma linha rejeitada por insert transformaria 343 descartes em
		// 343 idas ao banco.
		const linhas = buffer.map((r) => ({
			id_execucao: id,
			origem_ref: r.origemRef,
			motivo: r.motivo,
			campo: r.campo ?? null,
			payload_bruto: r.payload ?? null,
		}));

		const { error: erroRej } = await supabase
			.from("ingestao_rejeicao")
			.insert(linhas);

		if (erroRej) {
			console.error(
				`[Ingestão] Falha ao gravar ${linhas.length} rejeição(ões):`,
				erroRej.message,
			);
		}
	}

	return {
		id,
		rejeitar: (r) => void buffer.push(r),
		rejeitarVarias: (rs) => void buffer.push(...rs),
		get rejeicoes() {
			return buffer.length;
		},

		async finalizar(c) {
			await gravarRejeicoes();
			await supabase
				.from("ingestao_execucao")
				.update({
					terminado_em: new Date().toISOString(),
					// `ok` significa que nada se perdeu por FALHA. Rejeição é problema
					// da fonte, não da sincronização, e não marca a rodada como ruim.
					status: (c.erros ?? 0) > 0 ? "com_erros" : "ok",
					linhas_lidas: c.lidas ?? 0,
					linhas_aceitas: c.aceitas ?? 0,
					linhas_rejeitadas: c.rejeitadas ?? buffer.length,
					linhas_ignoradas: c.ignoradas ?? 0,
					linhas_removidas: c.removidas ?? 0,
				})
				.eq("id_execucao", id);
		},

		async falhar(erro) {
			// Grava o que já tinha sido rejeitado antes de estourar: metade do
			// diagnóstico costuma estar aí.
			await gravarRejeicoes();
			await supabase
				.from("ingestao_execucao")
				.update({
					terminado_em: new Date().toISOString(),
					status: "falhou",
					linhas_rejeitadas: buffer.length,
					erro: erro instanceof Error ? erro.message : String(erro),
				})
				.eq("id_execucao", id);
		},
	};
}
