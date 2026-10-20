// src/app/api/dashboard/funil/route.ts
//
// Endpoint da página /dashboard/funil. Tudo vem do Supabase (card + funil).
//
// SEGUE O SELETOR DE PERÍODO. Antes esta rota não recebia parâmetro nenhum e
// calculava sempre a gestão vigente — o seletor da página existia, mudava o
// rótulo do cabeçalho, e não alterava um número sequer do funil.

import { NextRequest, NextResponse } from "next/server";
import { buscarCardsComHistorico } from "@/lib/supabase-funil";
import {
	calcularKPIsFunilCompleto,
	calcularEntradaDireta,
	filtrarCardsPorCoordenacoes,
} from "@/lib/calculations-funil";
import { gestaoAtual } from "@/lib/periodo-gestao";
import {
	Coordenacao,
	PeriodoCiclo,
	PeriodoGestao,
	SelecaoPeriodoFunil,
} from "@/types";

export async function GET(request: NextRequest) {
	try {
		const { searchParams } = new URL(request.url);

		const sel: SelecaoPeriodoFunil = {
			gestao: (searchParams.get("gestao") as PeriodoGestao) ?? gestaoAtual(),
			tipo:
				(searchParams.get("tipo") as "gestao" | "ciclo" | "mes") ?? "gestao",
			ciclo: (searchParams.get("ciclo") as PeriodoCiclo | null) ?? undefined,
			mes: searchParams.get("mes") ?? undefined,
		};

		// Corte por coordenação no SERVIDOR. Feito no cliente, teria de somar os
		// funis por coordenação — e percentual de conversão não se soma, além de
		// contar duas vezes o card de cross-sell.
		const coordenacoes = (searchParams.get("coordenacoes") ?? "")
			.split(",")
			.map((c) => c.trim())
			.filter(Boolean) as Coordenacao[];

		const todos = await buscarCardsComHistorico();
		const cards = filtrarCardsPorCoordenacoes(todos, coordenacoes);

		return NextResponse.json({
			funil: calcularKPIsFunilCompleto(cards, sel),
			entradaDireta: calcularEntradaDireta(cards, sel),
			periodo: sel,
			coordenacoes,
		});
	} catch (error) {
		console.error("[API Funil]", error);
		return NextResponse.json(
			{ message: "Erro interno ao processar os dados do funil" },
			{ status: 500 },
		);
	}
}
