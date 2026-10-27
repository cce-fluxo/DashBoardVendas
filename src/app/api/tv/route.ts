// src/app/api/tv/route.ts
//
// Os dados do painel de TV (/tv), numa requisição só: a TV fica ligada o dia
// inteiro e pergunta a cada 5 minutos. Seis rotas por ciclo seriam seis leituras
// do banco por pergunta, para o mesmo período fixo.
//
// Sem parâmetros de propósito. A TV não tem seletor — mostra a gestão e o ciclo
// vigentes, e a data decide quais são (src/lib/tv.ts).

import { NextResponse } from "next/server";

import { medirFrescor } from "@/lib/auditoria/frescor";
import {
	cacheado,
	ehLeituraVazia,
	exigirLeitura,
	respostaLeituraVazia,
} from "@/lib/cache";
import { buscarGrafias, criarResolvedor } from "@/lib/pessoas";
import { buscarCardsComHistorico } from "@/lib/supabase-funil";
import {
	buscarEntregasDoBanco,
	buscarFaturamentoDoBanco,
	buscarMetasDoBanco,
	buscarVendasDoBanco,
} from "@/lib/supabase-vendas";
import { montarTv } from "@/lib/tv";

// Uma entrada só. O ciclo vigente muda de um dia para o outro; a validade de
// 30 min do cache cobre a virada sem chave por data.
const montarTvCacheado = cacheado("api-tv", async () => {
	const [vendas, cards, grafias, metas, metasFaturamento, faturamento, entregas] = await Promise.all([
		buscarVendasDoBanco(),
		buscarCardsComHistorico(),
		buscarGrafias(),
		buscarMetasDoBanco(),
		buscarMetasDoBanco("meta_faturamento"),
		buscarFaturamentoDoBanco(),
		buscarEntregasDoBanco(),
	]);
	// Faturamento e entregas vazios não barram: só a tela deles sai do ciclo.
	exigirLeitura({ vendas, cards });
	const fotos = new Map(
		grafias.flatMap((g) => (g.fotoUrl ? [[g.nomeExibicao, g.fotoUrl] as const] : [])),
	);
	return montarTv(vendas, cards, new Date(), fotos, {
		metas,
		metasFaturamento,
		faturamento,
		entregas,
		resolver: criarResolvedor(grafias),
	});
});

export async function GET() {
	try {
		// Idade do dado fora do cache, como em /api/dashboard: guardada, ela
		// esconderia justamente que o agendador parou.
		const [dados, frescor] = await Promise.all([montarTvCacheado(), medirFrescor()]);
		return NextResponse.json({
			...dados,
			ultimaAtualizacao: frescor.maisAtrasada?.ultimaCarga ?? null,
			dadoVelho: frescor.algumaVelha,
		});
	} catch (error) {
		if (ehLeituraVazia(error)) return respostaLeituraVazia(error);
		console.error("[API TV]", error);
		return NextResponse.json(
			{ message: "Erro interno ao montar o painel de TV" },
			{ status: 500 },
		);
	}
}
