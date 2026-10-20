// src/app/api/dashboard/origem/route.ts
//
// As linhas que compõem o total de um período (F8).
//
// É o fecho do objetivo "fonte auditável": um número na tela deixa de ser um
// número e passa a ser uma lista de contratos, cada um com a célula da planilha
// de onde saiu. Discordar do dash vira conferir uma linha, não desconfiar do
// sistema inteiro.

import { NextRequest, NextResponse } from "next/server";

import { buscarVendasDoBanco } from "@/lib/supabase-vendas";
import { vendasDoPeriodo } from "@/lib/snapshots/congelar";
import { quebrarOrigem } from "@/lib/auditoria/coletar";
import { PeriodoGestao } from "@/types";

export async function GET(request: NextRequest) {
	try {
		const { searchParams } = new URL(request.url);
		const gestao = searchParams.get("gestao") as PeriodoGestao | null;
		const tipo = (searchParams.get("tipo") ?? "gestao") as
			| "gestao"
			| "ciclo"
			| "mes";

		if (!gestao) {
			return NextResponse.json(
				{ message: 'Parâmetro "gestao" é obrigatório' },
				{ status: 400 },
			);
		}

		const sel = {
			gestao,
			tipo,
			ciclo: searchParams.get("ciclo"),
			mes: searchParams.get("mes"),
		};

		const todas = await buscarVendasDoBanco();
		// MESMO recorte da tela e do congelamento — se esta rota filtrasse por
		// conta própria, a lista poderia não somar o número que se quer conferir,
		// e uma conferência que não fecha é pior que nenhuma.
		const doPeriodo = vendasDoPeriodo(todas, sel);

		const linhas = doPeriodo
			.map((v) => {
				const { fonteNome, local } = v.origemRef
					? quebrarOrigem(v.origemRef)
					: { fonteNome: "—", local: "sem procedência" };
				return {
					projeto: v.projetoAssinado,
					coordenacao: v.coordenacao,
					mes: v.mes,
					assinado: v.assinado,
					valorVendidoReal: v.valorVendidoReal,
					canal: v.canalDeAquisicao,
					origemRef: v.origemRef ?? null,
					fonteNome,
					local,
				};
			})
			.sort((a, b) => b.valorVendidoReal - a.valorVendidoReal);

		// Só as assinadas somam — mesma regra de `calcularKPIsVendas`. As não
		// assinadas continuam na lista, marcadas: sumir com elas esconderia
		// justamente a explicação de "por que o total é menor do que eu esperava".
		const assinadas = linhas.filter((l) => l.assinado);

		return NextResponse.json({
			periodo: sel,
			total: assinadas.reduce((s, l) => s + l.valorVendidoReal, 0),
			numeroDeVendas: assinadas.length,
			naoAssinadas: linhas.length - assinadas.length,
			linhas,
		});
	} catch (error) {
		console.error("[API Origem]", error);
		return NextResponse.json(
			{ message: "Erro interno ao buscar a origem dos números" },
			{ status: 500 },
		);
	}
}
