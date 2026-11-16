// src/lib/sync-prospeccao.ts
//
// Pipe "[CRM] Prospecção Ativa" → tabela `prospeccao_card` (migration 0020),
// para a competição de outbound da TV (src/lib/outbound.ts).
//
// FORA DO REGISTRY `PIPES` de propósito: lá o card vira `card`, que alimenta
// funil, faixa de lead novo e "alocados". Os ~800 cards de base da prospecção
// entrariam em todos, e as fases não são as 8 etapas canônicas.
//
// Varredura COMPLETA a cada rodada (~800 cards, ~25 s medidos em 16/11/2026),
// gravação em lote e remoção do que não apareceu: com a varredura inteira, o que
// sumiu foi arquivado ou excluído no Pipefy.
// ponytail: incremental por `updated_at`, como em sync-pipefy.ts, se a rodada do
// cron começar a encostar no teto.

import { createClient } from "@supabase/supabase-js";

import { chaveEmail, chaveTelefone } from "@/lib/fontes/contato";
import { abrirExecucao, type DisparadoPor } from "@/lib/ingestao/registro";
import { FASES_PROSPECCAO, PIPE_PROSPECCAO } from "@/lib/outbound";
import { fetchPipefy } from "@/lib/sync-pipefy";

interface CardRaw {
	id: string;
	title: string;
	createdAt: string;
	updated_at: string;
	current_phase: { name: string };
	fields: { field: { label: string }; value?: string | null }[];
	phases_history: { phase: { name: string }; firstTimeIn: string | null }[];
}

const consultaCards = (fase: string, cursor?: string) => `query {
  phase(id: "${fase}") {
    cards(first: 50${cursor ? `, after: "${cursor}"` : ""}) {
      edges { node {
        id title createdAt updated_at
        current_phase { name }
        fields { field { label } value }
        phases_history { phase { name } firstTimeIn }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

/** "SDR responsável" é assignee_select: o value vem como '["Nome"]'. */
function primeiroNome(valor: string | null | undefined): string | null {
	if (!valor) return null;
	try {
		const v = JSON.parse(valor);
		return (Array.isArray(v) ? v[0] : v)?.toString().trim() || null;
	} catch {
		return valor.trim() || null;
	}
}

const LOTE = 500;
const FASES = new Set<string>(FASES_PROSPECCAO);

export async function sincronizarProspeccao(disparadoPor: DisparadoPor) {
	const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
	const execucao = await abrirExecucao({ fonteTipo: "pipefy", fonteRef: PIPE_PROSPECCAO, disparadoPor });

	try {
		const { pipe } = await fetchPipefy<{ pipe: { phases: { id: string; name: string }[] } }>(
			`query { pipe(id: ${PIPE_PROSPECCAO}) { phases { id name } } }`,
		);

		const cards: CardRaw[] = [];
		for (const fase of pipe.phases) {
			if (!FASES.has(fase.name)) {
				// Fase nova no Pipefy: os cards dela ainda são lidos, mas a regra de
				// pontos (outbound.ts) não sabe o que ela significa.
				execucao.rejeitar({
					origemRef: `${PIPE_PROSPECCAO}#fase:${fase.id}`,
					motivo: `fase da prospecção ausente de FASES_PROSPECCAO: "${fase.name}"`,
					campo: "fase",
				});
			}
			let cursor: string | undefined;
			for (;;) {
				const d = await fetchPipefy<{ phase: { cards: { edges: { node: CardRaw }[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } }>(
					consultaCards(fase.id, cursor),
				);
				cards.push(...d.phase.cards.edges.map((e) => e.node));
				if (!d.phase.cards.pageInfo.hasNextPage) break;
				cursor = d.phase.cards.pageInfo.endCursor;
			}
		}

		let semSdr = 0;
		const linhas = cards.map((c) => {
			const campo = (label: string) => c.fields.find((f) => f.field.label === label)?.value ?? null;
			const sdr = primeiroNome(campo("SDR responsável"));
			if (!sdr) {
				// Gravado mesmo assim (conta nos marcos se o SDR for preenchido depois),
				// mas ninguém pontua por ele agora.
				semSdr++;
				execucao.rejeitar({
					origemRef: `${PIPE_PROSPECCAO}#${c.id}`,
					motivo: "card de prospecção sem \"SDR responsável\": não pontua para ninguém",
					campo: "sdr",
					payload: { titulo: c.title },
				});
			}
			return {
				pipefy_id: c.id,
				nome_card: c.title,
				empresa: campo("Empresa"),
				email_hash: chaveEmail(campo("E-mail")),
				telefone_hash: chaveTelefone(campo("Telefone")),
				sdr,
				etapa_atual: c.current_phase.name,
				data_criacao: c.createdAt,
				data_last_update: c.updated_at,
				fases: c.phases_history.filter((h) => h.firstTimeIn).map((h) => ({ fase: h.phase.name, em: h.firstTimeIn })),
			};
		});

		for (let i = 0; i < linhas.length; i += LOTE) {
			const { error } = await supabase.from("prospeccao_card").upsert(linhas.slice(i, i + LOTE), { onConflict: "pipefy_id" });
			if (error) throw new Error(`gravar prospecção: ${error.message}`);
		}

		// O que está no banco e não veio na varredura completa saiu do pipe.
		const vistos = new Set(linhas.map((l) => l.pipefy_id));
		const sumiram: string[] = [];
		for (let inicio = 0; ; inicio += 1000) {
			const { data, error } = await supabase
				.from("prospeccao_card")
				.select("pipefy_id")
				.order("id_prospeccao", { ascending: true })
				.range(inicio, inicio + 999);
			if (error) throw new Error(`ler prospecção: ${error.message}`);
			sumiram.push(...data.map((r) => r.pipefy_id as string).filter((id) => !vistos.has(id)));
			if (data.length < 1000) break;
		}
		for (let i = 0; i < sumiram.length; i += LOTE) {
			const { error } = await supabase.from("prospeccao_card").delete().in("pipefy_id", sumiram.slice(i, i + LOTE));
			if (error) throw new Error(`remover prospecção: ${error.message}`);
		}

		await execucao.finalizar({ lidas: cards.length, aceitas: cards.length - semSdr, rejeitadas: semSdr, removidas: sumiram.length });
		return { lidos: cards.length, removidos: sumiram.length, semSdr };
	} catch (erro) {
		await execucao.falhar(erro);
		throw erro;
	}
}
