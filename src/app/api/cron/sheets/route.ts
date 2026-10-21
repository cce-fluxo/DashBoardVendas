// src/app/api/cron/sheets/route.ts
//
// Chamado uma vez por dia pelo pg_cron do Supabase (agendador principal) e
// pelo GitHub Actions (reserva). Ver docs/automacoes.md.
// Protegido por CRON_SECRET para evitar chamadas não autorizadas.

import { NextRequest, NextResponse } from "next/server";
import { invalidarDados } from "@/lib/cache";
import { sincronizarSheets } from "@/lib/sync-sheets";

/**
 * Teto de execução da função.
 *
 * O padrão da plataforma derrubou este endpoint com 504
 * FUNCTION_INVOCATION_TIMEOUT: a varredura reescrevia os 148 cards do pipe a
 * cada rodada e levava 275s. Hoje a sincronização é incremental (só o que mudou
 * na origem) e fecha em ~9s — a folga aqui é margem, não muleta. Se voltar a
 * encostar no teto, a resposta é descobrir por que a rodada cresceu, não subir
 * este número.
 */
export const maxDuration = 300;

export async function POST(req: NextRequest) {
	// Valida o secret token
	const authHeader = req.headers.get("authorization");
	const token = authHeader?.replace("Bearer ", "");

	if (token !== process.env.CRON_SECRET) {
		return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
	}

	try {
		console.log("[Cron Sheets] Iniciando sincronização...");
		const resultado = await sincronizarSheets({ disparadoPor: "cron" });
		console.log(`[Cron Sheets] Concluído:`, resultado);

		// `ok` reflete o resultado real. Antes era `true` fixo, então uma rodada em
		// que TODAS as metas falharam ainda respondia sucesso — e o workflow, que
		// só olha o código HTTP, nunca percebia.
		//
		// Rejeições NÃO derrubam o `ok`: são problemas da planilha (linha sem
		// coordenação, meta ainda não definida), não falhas de sincronização.
		// Aparecem no corpo para ficarem visíveis sem gerar alarme falso.
		return NextResponse.json({
			ok: resultado.totais.erros === 0,
			...resultado,
			timestamp: new Date().toISOString(),
		});
	} catch (err) {
		console.error("[Cron Sheets] Erro:", err);
		// A mensagem vai no corpo: a rota é protegida por CRON_SECRET e o corpo é o
		// que o workflow imprime. Com "Erro interno" fixo, a virada de gestão
		// (gestão vigente sem fonte no registry) apareceu como um 500 mudo — e
		// como a exceção sai antes de abrir a execução, não deixou rastro nenhum
		// em `ingestao_execucao`.
		const mensagem = err instanceof Error ? err.message : String(err);
		return NextResponse.json(
			{ ok: false, error: "Erro interno", detalhe: mensagem },
			{ status: 500 },
		);
	} finally {
		// Mesmo com erro: parte da carga pode ter sido gravada. As rotas de
		// leitura passam a recalcular a partir do banco. Ver src/lib/cache.ts.
		invalidarDados();
	}
}
