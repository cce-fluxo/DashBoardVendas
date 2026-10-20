// src/app/api/dashboard/atualizar/route.ts
//
// O botão de atualizar da tela. Vai à FONTE, não ao banco.
//
// Diferente de /api/cron/pipefy em três pontos:
//   · não pede CRON_SECRET — o navegador não tem onde guardar um segredo;
//   · trava por cooldown e por execução em andamento (ver disparo-manual.ts),
//     que é o que substitui o segredo como proteção de quota;
//   · nunca varre fases terminais nem força reescrita: isso é backfill, leva
//     ~40 min e não é o que alguém espera de um clique.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sincronizarPipefy } from "@/lib/sync-pipefy";
import { sincronizarSheets } from "@/lib/sync-sheets";
import { decidirDisparo, type ExecucaoResumida } from "@/lib/ingestao/disparo-manual";

/**
 * Teto de execução. Pipefy incremental tem p90 de 7s e a planilha fecha em ~6s
 * desde a gravação em lote. 120s é margem larga para as duas somadas — não é
 * espaço para a rodada crescer.
 */
export const maxDuration = 120;

async function ultimaExecucao(
	fonteTipo: "pipefy" | "sheets",
): Promise<ExecucaoResumida | null> {
	const supabase = createClient(
		process.env.SUPABASE_URL!,
		process.env.SUPABASE_SERVICE_ROLE_KEY!,
	);

	const { data, error } = await supabase
		.from("ingestao_execucao")
		.select("status, iniciado_em, terminado_em")
		.eq("fonte_tipo", fonteTipo)
		.order("id_execucao", { ascending: false })
		.limit(1)
		.maybeSingle();

	// Query que falha NÃO é "nunca rodou". Devolver null aqui liberaria o
	// disparo justamente quando não dá para saber se já tem um rodando.
	if (error) throw new Error(`ler execuções: ${error.message}`);
	return data ?? null;
}

export async function POST() {
	try {
		// As duas fontes, sempre — cada uma com o seu próprio cooldown.
		//
		// A planilha ficava de fora, e só entrava quando já estava vencida (30h).
		// Era a fonte ERRADA para deixar de fora: quem vê uma rejeição na
		// auditoria vai corrigir a planilha e quer conferir na hora. Com a leitura
		// custando 45s isso não cabia num clique; agora a rodada inteira fecha em
		// ~6s (ver "Gravação em lote" em sync-sheets.ts).
		const [decisaoPipefy, decisaoPlanilha] = await Promise.all([
			ultimaExecucao("pipefy").then((e) => decidirDisparo(e)),
			ultimaExecucao("sheets").then((e) => decidirDisparo(e)),
		]);

		const fontes: Record<string, unknown> = {};

		// Sequencial: as duas escrevem no mesmo banco, e a leitura do Sheets tem
		// cota por minuto. Somadas dão ~10s, dentro do que um clique aguenta.
		if (decisaoPipefy.acao === "sincronizar") {
			fontes.pipefy = (
				await sincronizarPipefy({
					disparadoPor: "manual",
					// Sem isto, `manual` cairia no padrão do backfill: varredura
					// completa com reescrita forçada, ~40 min dentro de um HTTP.
					incluirTerminais: false,
					forcar: false,
				})
			).totais;
		} else {
			fontes.pipefy = decisaoPipefy;
		}

		if (decisaoPlanilha.acao === "sincronizar") {
			fontes.planilha = (await sincronizarSheets({ disparadoPor: "manual" })).totais;
		} else {
			fontes.planilha = decisaoPlanilha;
		}

		const sincronizou =
			decisaoPipefy.acao === "sincronizar" ||
			decisaoPlanilha.acao === "sincronizar";

		return NextResponse.json({
			estado: sincronizou ? "atualizado" : decisaoPipefy.acao,
			...fontes,
		});
	} catch (err) {
		console.error("[Atualizar]", err);
		return NextResponse.json(
			{ estado: "erro", mensagem: "Não foi possível atualizar agora." },
			{ status: 500 },
		);
	}
}
