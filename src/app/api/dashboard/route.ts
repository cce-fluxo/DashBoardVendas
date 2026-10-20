import { NextRequest, NextResponse } from "next/server";
import {
	buscarVendasDoBanco,
	buscarMetasDoBanco,
} from "@/lib/supabase-vendas";
import { gestaoAtual, gestaoAnterior } from "@/lib/periodo-gestao";
import { idsDeGestao } from "@/lib/fontes/registry";
import { buscarCardsComHistorico } from "@/lib/supabase-funil";
import { metaDoPeriodo, metasPorCoordenacao } from "@/lib/metas-periodo";
import { buscarSnapshot, compararComAFonte } from "@/lib/snapshots/ler";
import { VERSAO_CALCULO } from "@/lib/snapshots/metricas";
import { medirFrescor } from "@/lib/auditoria/frescor";
import { filtrarCardsPorPeriodo } from "@/lib/calculations-funil";

import {
	calcularKPIsVendas,
	calcularKPIsPorCoordenacao,
	negociacoesSemCoordenacao,
	calcularKPIsPorVendedor,
	calcularKPIsPorCanal,
	calcularVendasPorMes,
	calcularComparativoAnalitico,
	calcularLTV,
	porGestao,
	porCiclo,
	porMes,
} from "@/lib/calculations";
import {
	DashboardData,
	OrigemDosNumeros,
	PeriodoCiclo,
	PeriodoGestao,
} from "@/types";

export async function GET(request: NextRequest) {
	try {
		const { searchParams } = new URL(request.url);
		const tipo =
			(searchParams.get("tipo") as "gestao" | "ciclo" | "mes") ?? "gestao";
		// Sem parâmetro, a gestão vigente sai da DATA — não de uma constante que
		// alguém precisa lembrar de editar todo 1º de outubro.
		const gestao = (searchParams.get("gestao") as PeriodoGestao) ?? gestaoAtual();
		const ciclo = searchParams.get("ciclo") as PeriodoCiclo | null;
		const mes = searchParams.get("mes");

		// TUDO vem do Supabase — Pipefy e Google Sheets não são chamados aqui.
		// Vendas e metas liam a planilha a cada request até a F3; ver
		// src/lib/supabase-vendas.ts para o porquê da mudança.
		const [todasVendas, todasMetas, cardsComHistorico, frescor] =
			await Promise.all([
				buscarVendasDoBanco(),
				buscarMetasDoBanco(),
				buscarCardsComHistorico(),
				medirFrescor(),
			]);

		// Separa por gestão
		const vendasAtuais = porGestao(todasVendas, gestao);

		// A gestão anterior é aritmética, e só existe se estiver no registry.
		const anterior = gestaoAnterior(gestao);
		const anteriorExiste = idsDeGestao().includes(anterior);
		const vendasAnteriores = anteriorExiste
			? porGestao(todasVendas, anterior)
			: [];
		const temGestaoAnterior = vendasAnteriores.length > 0;

		// Aplica filtro de período sobre a gestão atual
		let vendasFiltradas = vendasAtuais;
		if (tipo === "ciclo" && ciclo) {
			vendasFiltradas = porCiclo(vendasAtuais, ciclo, gestao);
		}
		if (tipo === "mes" && mes) {
			vendasFiltradas = porMes(vendasAtuais, mes);
		}

		// A busca de meta saiu daqui para src/lib/metas-periodo.ts: o congelamento
		// de período (F7) precisa da MESMA regra, e uma segunda cópia garantiria
		// que um dia o número congelado e o da tela discordassem.
		const sel = { gestao, tipo, ciclo, mes };

		const meta = metaDoPeriodo(todasMetas, sel);
		const metaAnterior = anteriorExiste
			? (todasMetas.find(
					(m) => m.gestao === anterior && !m.ciclo && !m.mes && !m.coordenacao,
				) ?? null)
			: null;

		// Mesmo recorte do funil: a página de vendas e a do funil precisam contar
		// os mesmos cards para o mesmo período selecionado.
		const cardsDoPeriodo = filtrarCardsPorPeriodo(cardsComHistorico, {
			gestao,
			tipo,
			ciclo: ciclo ?? undefined,
			mes: mes ?? undefined,
		});

		// ── Congelamento (F7) ────────────────────────────────────────
		//
		// Período fechado e congelado devolve o snapshot; aberto calcula ao vivo.
		// A resposta diz QUAL, porque os dois números são visualmente idênticos e
		// significam coisas diferentes: um é o que a gestão fechou, o outro é o
		// que a planilha diz hoje.
		//
		// Dois snapshots, e a distinção importa: `vendasPorMes` e o comparativo
		// usam a gestão INTEIRA, não o período filtrado. Servir o mês congelado
		// ao lado de um gráfico anual ao vivo faria a tela discordar de si mesma.
		const [snapPeriodo, snapGestao] = await Promise.all([
			buscarSnapshot(sel),
			tipo === "gestao"
				? Promise.resolve(null)
				: buscarSnapshot({ gestao, tipo: "gestao" }),
		]);
		const congelado = snapPeriodo.snapshot;
		const congeladoGestao =
			tipo === "gestao" ? congelado : (snapGestao?.snapshot ?? null);

		const divergencia = congelado
			? compararComAFonte(congelado, VERSAO_CALCULO, todasVendas, todasMetas)
			: null;

		const origemDosNumeros: OrigemDosNumeros = congelado
			? {
					tipo: "congelado",
					congeladoEm: congelado.geradoEm,
					versaoCalculo: congelado.versaoCalculo,
					recalculoDisponivel: snapPeriodo.recalculoDisponivel,
					divergenteDaFonte: (divergencia?.diferencas.length ?? 0) > 0,
					integro: divergencia?.hashConfere ?? true,
					abrangencia:
						"Vendas, metas, coordenações, canais e vendedores. " +
						"Funil, LTV e comparativos entre gestões seguem ao vivo.",
				}
			: { tipo: "ao_vivo" };

		// Calcula todos os KPIs
		const dashboardData: DashboardData = {
			gestaoAtual: gestao,
			periodoSelecionado: {
				tipo,
				valor:
					tipo === "ciclo"
						? (ciclo ?? "")
						: tipo === "mes"
							? (mes ?? "")
							: gestao,
			},
			vendas: congelado
				? {
						...calcularKPIsVendas(
							vendasFiltradas,
							meta,
							temGestaoAnterior ? vendasAnteriores : undefined,
						),
						// Só o que o snapshot cobre. `variacaoVsGestaoAnterior` compara
						// com OUTRA gestão e não pertence ao congelado deste período.
						totalVendido: congelado.metricas.totalVendido,
						numeroDeVendas: congelado.metricas.numeroDeVendas,
						ticketMedio: congelado.metricas.ticketMedio,
						metaDefinida: congelado.metricas.metaDefinida,
						metaVendas: congelado.metricas.metaVendas,
						percentualMeta: congelado.metricas.percentualMeta,
						gapMeta: congelado.metricas.metaDefinida
							? congelado.metricas.metaVendas - congelado.metricas.totalVendido
							: 0,
					}
				: calcularKPIsVendas(
						vendasFiltradas,
						meta,
						temGestaoAnterior ? vendasAnteriores : undefined,
					),
			// Só os campos de VENDA vêm do congelado. `valorAFechar`,
			// `oportunidadesNoFunil` e `projetosEmNegociacao` descrevem o board do
			// Pipefy AGORA — congelá-los seria mostrar um funil de 2024 como se
			// fosse o estado atual da negociação.
			porCoordenacao: calcularKPIsPorCoordenacao(
				vendasFiltradas,
				// Cards do PERÍODO, não todos. "Valor a fechar" e "projetos em
				// negociação" descrevem o que nasceu no recorte escolhido e ainda
				// está aberto — antes vinha o board inteiro, então trocar o período
				// mexia nas vendas e não mexia no funil, na mesma linha da tabela.
				cardsDoPeriodo,
				metasPorCoordenacao(todasMetas, sel),
			).map((c) => {
				const f = congelado?.metricas.porCoordenacao.find(
					(x) => x.coordenacao === c.coordenacao,
				);
				if (!f) return c;
				return {
					...c,
					totalVendido: f.totalVendido,
					numeroDeVendas: f.numeroDeVendas,
					ticketMedio:
						f.numeroDeVendas > 0 ? f.totalVendido / f.numeroDeVendas : 0,
					metaVendas: f.metaVendas,
				};
			}),
			// Mesmos cards e mesmas 3 fases de `porCoordenacao` — se saísse de outro
			// recorte, a nota diria respeito a uma tabela diferente da que está ao
			// lado dela.
			negociacoesSemCoordenacao: negociacoesSemCoordenacao(cardsDoPeriodo),
			porVendedor: congelado
				? congelado.metricas.porVendedor.map((v) => ({
						...v,
						ticketMedio:
							v.numeroDeVendas > 0 ? v.totalVendido / v.numeroDeVendas : 0,
					}))
				: calcularKPIsPorVendedor(vendasFiltradas),
			porCanal: congelado
				? congelado.metricas.porCanal
				: calcularKPIsPorCanal(vendasFiltradas),
			vendasPorMes: congeladoGestao
				? calcularVendasPorMes(vendasAtuais).map((m) => {
						const c = congeladoGestao.metricas.porMes.find(
							(x) => x.mes === m.mes,
						);
						return c ? { ...m, ...c } : m;
					})
				: calcularVendasPorMes(vendasAtuais),
			ltv: calcularLTV(todasVendas),
			comparativo: {
				gestaoAtual: calcularKPIsVendas(vendasAtuais, meta),
				gestaoAnterior: temGestaoAnterior
					? calcularKPIsVendas(vendasAnteriores, metaAnterior)
					: null,
			},
			comparativoAnalitico: calcularComparativoAnalitico(
				vendasAtuais,
				temGestaoAnterior ? vendasAnteriores : [],
				meta,
				gestao,
				cardsComHistorico,
				{ tipo, ciclo: ciclo ?? undefined, mes: mes ?? undefined },
			),
			// A hora da FONTE, não a da requisição. Ver o comentário do campo.
			// A fonte mais próxima de estourar o PRÓPRIO limite, não a mais antiga
			// em horas — ver o comentário de `atraso` em auditoria/frescor.ts.
			ultimaAtualizacao: frescor.maisAtrasada?.ultimaCarga ?? null,
			fonteMaisAtrasada: frescor.maisAtrasada?.nome ?? null,
			frescor: frescor.fontes,
			dadoVelho: frescor.algumaVelha,
			origemDosNumeros,
		};

		return NextResponse.json(dashboardData);
	} catch (error) {
		console.error("[API Dashboard]", error);
		return NextResponse.json(
			{ message: "Erro interno ao processar os dados do dashboard" },
			{ status: 500 },
		);
	}
}
