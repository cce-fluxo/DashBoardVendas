// src/app/api/dashboard/comparador-funil/route.ts
//
// Comparador periódico de funil (F1).
// Recebe a seleção de dois períodos (A e B) e retorna o comparativo de coortes.
// Um único fetch do Supabase; os dois recortes são calculados em memória.

import { NextRequest, NextResponse } from "next/server";
import { buscarCardsComHistorico } from "@/lib/supabase-funil";
import { calcularComparativoFunilPeriodos } from "@/lib/calculations-funil";
import { SelecaoPeriodoFunil, PeriodoGestao, PeriodoCiclo } from "@/types";

function lerSelecao(
	params: URLSearchParams,
	lado: "A" | "B",
): SelecaoPeriodoFunil | null {
	const gestao = params.get(`gestao${lado}`) as PeriodoGestao | null;
	const tipo = params.get(`tipo${lado}`) as
		| "gestao"
		| "ciclo"
		| "mes"
		| null;

	if (!gestao || !tipo) return null;

	return {
		gestao,
		tipo,
		ciclo: (params.get(`ciclo${lado}`) as PeriodoCiclo | null) ?? undefined,
		mes: params.get(`mes${lado}`) ?? undefined,
	};
}

export async function GET(request: NextRequest) {
	try {
		const { searchParams } = new URL(request.url);

		const selA = lerSelecao(searchParams, "A");
		const selB = lerSelecao(searchParams, "B");

		if (!selA || !selB) {
			return NextResponse.json(
				{ message: "Parâmetros de período (A e B) são obrigatórios" },
				{ status: 400 },
			);
		}

		// equalizar=false desliga a janela equalizada; default é ligada.
		const equalizar = searchParams.get("equalizar") !== "false";

		const cards = await buscarCardsComHistorico();
		const comparativo = calcularComparativoFunilPeriodos(cards, selA, selB, {
			equalizar,
		});

		return NextResponse.json(comparativo);
	} catch (error) {
		console.error("[API Comparador Funil]", error);
		return NextResponse.json(
			{ message: "Erro interno ao calcular o comparador de funil" },
			{ status: 500 },
		);
	}
}
