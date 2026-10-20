// src/app/api/cron/pipefy/route.ts
//
// Chamado pelo pg_cron do Supabase a cada 30 minutos (agendador principal) e
// pelo GitHub Actions a cada 6 horas (reserva). Ver docs/automacoes.md.
// Protegido por CRON_SECRET para evitar chamadas não autorizadas.

import { NextRequest, NextResponse } from "next/server";
import { sincronizarPipefy } from "@/lib/sync-pipefy";

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
		console.log("[Cron Pipefy] Iniciando sincronização...");
		const resultado = await sincronizarPipefy({ disparadoPor: "cron" });
		console.log(`[Cron Pipefy] Concluído:`, resultado);

		// `ok` reflete o resultado real — ver a nota equivalente em cron/sheets.
		// Rejeições (fase não mapeada) NÃO derrubam o ok: são problema da fonte,
		// não da sincronização. Aparecem no corpo para ficarem visíveis.
		return NextResponse.json({
			ok: resultado.totais.erros === 0,
			...resultado,
			timestamp: new Date().toISOString(),
		});
	} catch (err) {
		console.error("[Cron Pipefy] Erro:", err);
		return NextResponse.json({ error: "Erro interno" }, { status: 500 });
	}
}
