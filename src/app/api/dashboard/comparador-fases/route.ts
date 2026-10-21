// src/app/api/dashboard/comparador-fases/route.ts
//
// Endpoint dedicado ao Comparador de Fases.
// Recebe etapaDe e etapaPara via query params, retorna o percentual de conversão.
// Todos os dados vêm do Supabase (tabelas card + funil).

import { NextRequest, NextResponse } from "next/server";
import { buscarCardsComHistorico } from "@/lib/supabase-funil";
import { calcularComparadorFases } from "@/lib/calculations-funil";
import { gestaoAtual } from "@/lib/periodo-gestao";
import {
	cacheado,
	ehLeituraVazia,
	exigirLeitura,
	respostaLeituraVazia,
} from "@/lib/cache";
import {
	EtapaFunil,
	PeriodoCiclo,
	PeriodoGestao,
	SelecaoPeriodoFunil,
} from "@/types";

/** Uma entrada por par de etapas e período. Ver src/lib/cache.ts. */
const calcularComparador = cacheado(
	"api-comparador-fases",
	async (etapaDe: EtapaFunil, etapaPara: EtapaFunil, sel: SelecaoPeriodoFunil) => {
		const cards = await buscarCardsComHistorico();
		exigirLeitura({ cards });
		return calcularComparadorFases(cards, etapaDe, etapaPara, sel);
	},
);

export async function GET(request: NextRequest) {
	try {
		const { searchParams } = new URL(request.url);
		const etapaDe = searchParams.get("de") as EtapaFunil | null;
		const etapaPara = searchParams.get("para") as EtapaFunil | null;

		if (!etapaDe || !etapaPara) {
			return NextResponse.json(
				{ message: 'Parâmetros "de" e "para" são obrigatórios' },
				{ status: 400 },
			);
		}

		// Também segue o seletor: é o mesmo funil, no mesmo período, respondendo a
		// um recorte diferente. Ficar fora faria as duas seções da mesma tela
		// discordarem sobre quais cards estão sendo contados.
		const sel: SelecaoPeriodoFunil = {
			gestao: (searchParams.get("gestao") as PeriodoGestao) ?? gestaoAtual(),
			tipo:
				(searchParams.get("tipo") as "gestao" | "ciclo" | "mes") ?? "gestao",
			ciclo: (searchParams.get("ciclo") as PeriodoCiclo | null) ?? undefined,
			mes: searchParams.get("mes") ?? undefined,
		};

		const resultado = await calcularComparador(etapaDe, etapaPara, sel);

		return NextResponse.json(resultado);
	} catch (error) {
		if (ehLeituraVazia(error)) return respostaLeituraVazia(error);
		console.error("[API Comparador Fases]", error);
		return NextResponse.json(
			{ message: "Erro interno ao calcular comparador de fases" },
			{ status: 500 },
		);
	}
}
