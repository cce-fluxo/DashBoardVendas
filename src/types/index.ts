// src/types/index.ts
//
// Tipos que a API devolve e as telas consomem.

// ─── Coordenações ────────────────────────────────────────────────
export type Coordenacao = "CCE" | "ACE" | "MNP" | "QAB" | "PRO";

// ─── Períodos de gestão ──────────────────────────────────────────
//
// Eram uniões literais fechadas (`"24/25" | "25/26"` e `"Q1".."Q4"`). Viraram
// string porque nenhuma das duas é decidida pelo código:
//
//   · A gestão avança sozinha em 01/10 de cada ano. A união fechada quebraria
//     em 01/10/2026 e exigia editar sete arquivos por ano.
//   · Ciclo NUNCA se chamou "Q1" — cada gestão nomeia os seus (Waterloo,
//     Stalingrado, Normandia em 24/25) e escolhe quantos são (3 de 4 meses em
//     23/24 e 24/25; 4 de 3 meses em 25/26).
//
// Quem valida é o registry (src/lib/fontes/), que confere formato E calendário —
// contiguidade e cobertura dos 12 meses, coisa que um tipo não faz.

/** Rótulo de gestão "AA/BB". Validado pelo registry, não pelo tipo. */
export type PeriodoGestao = string;

/** Id de ciclo dentro de uma gestão. Ex.: "waterloo", "fogo". */
export type PeriodoCiclo = string;

// ─── Venda ───────────────────────────────────────────────────────
export interface Venda {
	mes: string;
	projetoAssinado: string;
	contratante?: string;
	responsavel1?: string;
	responsavel2?: string;
	responsavel3?: string;
	responsavel4?: string;
	assinado: boolean;
	coordenacao: Coordenacao;
	itemDaCarta: string;
	prazo: number;
	valorContrato: number;
	valorVendidoReal: number;
	/** "AAAA-MM-DD", como no banco. String de propósito: ver `mesDaData`. */
	dataAssinatura?: string;
	dataFinalizacaoEstimativa?: Date;
	valorContratoParcelas: number;
	precoPorSemana: number;
	numeroParcelas: number;
	canalDeAquisicao: string;
	fidelizacao: boolean;
	compiladoNoPortal: boolean;
	gestao: PeriodoGestao;
	/**
	 * De onde esta venda veio: `<planilhaId>#<aba>#L<linha>`.
	 *
	 * É o que permite clicar num KPI e chegar na CÉLULA que o originou (F8).
	 * Opcional porque venda fabricada em teste não tem procedência — e forçar um
	 * valor de mentira ali seria pior que a ausência.
	 */
	origemRef?: string;
}

// ─── Etapas do funil (Pipefy) ────────────────────────────────────
export type EtapaFunil =
	| "Oportunidade"
	| "Contato aberto"
	| "Pré-diagnóstico feito"
	| "Diagnóstico feito"
	| "Precificação/Aprovação em andamento"
	| "Proposta comercial feita"
	| "Follow-up"
	| "Venda";

// ─── Metas ───────────────────────────────────────────────────────
export interface MetaPeriodo {
	gestao: PeriodoGestao;
	ciclo?: string;
	mes?: string;
	metaVendas: number;
	coordenacao?: Coordenacao | null; // null = meta geral da Fluxo; preenchido = meta por coord
}

// ─── KPIs de vendas ─────────────────────────────────────────
export interface KPIsVendas {
	totalVendido: number;
	numeroDeVendas: number;
	ticketMedio: number;
	metaVendas: number;
	/**
	 * Existe meta cadastrada para ESTE período?
	 *
	 * Sem isso, "não há meta" e "meta zero" viram o mesmo número na tela. Havia
	 * um fallback que, faltando a meta do mês, usava a da GESTÃO — as vendas de
	 * um mês apareciam contra a meta do ano inteiro, com atingimento de 4%.
	 */
	metaDefinida: boolean;
	percentualMeta: number;
	gapMeta: number;
	variacaoVsGestaoAnterior?: number;
}

export interface KPIsPorCoordenacao {
	coordenacao: Coordenacao;
	totalVendido: number;
	numeroDeVendas: number;
	ticketMedio: number;
	valorAFechar: number;
	oportunidadesNoFunil: number;
	projetosEmNegociacao: {
		id_card: number; // para deduplicação de cross-sell no total
		titulo: string;
		valor: number;
		etapa: EtapaFunil;
		isCrossSell: boolean; // aparece em mais de uma coordenação
		coordenacoes: string[]; // todas as coordenações participantes (pode incluir valores não padrão)
	}[];
	metaVendas: number; // meta específica desta coordenação no período selecionado
}

export interface KPIsPorVendedor {
	responsavel: string;
	totalVendido: number;
	numeroDeVendas: number;
	ticketMedio: number;
}

// ─── KPIs de tempo de funil ──────────────────────────────────────
//
// MUDANÇA: tempoMedioTotalDias foi substituído por dois campos semânticos.
//
//   tempoMedioVendaDias        → MÉTRICA PRINCIPAL para exibição.
//     Média de dias da entrada no funil até "Venda".
//     Base: apenas cards com etapa_atual === "Venda".
//     Responde: "quanto tempo leva para uma venda acontecer?"
//
//   tempoMedioFechamentoDias   → MÉTRICA SECUNDÁRIA.
//     Igual ao anterior, mas inclui Perdido e Pausado.
//     Responde: "quanto tempo dura um ciclo até qualquer fechamento?"
//
//   totalVendas                → quantos cards basearam tempoMedioVendaDias
//     (útil para avaliar a confiabilidade da amostra por coordenação).

export interface EtapaTempo {
	etapa: EtapaFunil;
	tempoMedioHoras: number;
	/**
	 * A fase não existia no pipe de origem destes cards.
	 * `tempoMedioHoras` é 0 por ausência de fase, não por rapidez — a UI precisa
	 * mostrar "—", porque "0 horas" lê-se como instantâneo.
	 */
	naoInstrumentada?: boolean;
}

export interface KPIsFunilTempo {
	etapas: EtapaTempo[];
	// Métrica principal: entrada no funil → Venda. Só cards vendidos.
	tempoMedioVendaDias: number;
	// Métrica secundária: entrada no funil → qualquer fechamento (Venda+Perdido+Pausado).
	tempoMedioFechamentoDias: number;
	// Tamanho da amostra que gerou tempoMedioVendaDias.
	totalVendas: number;
}

export interface KPILTV {
	ticketMedio: number;
	mediaRenovacoes: number;
	ltv: number;
}

/**
 * De onde vieram os números de venda desta resposta.
 *
 * Período fechado e congelado (F7) lê o snapshot; período aberto calcula ao
 * vivo. A tela PRECISA dizer qual, porque as duas coisas parecem idênticas e
 * significam coisas diferentes: uma é o que foi fechado, a outra é o que a
 * planilha diz agora.
 */
export interface OrigemDosNumeros {
	tipo: "congelado" | "ao_vivo";
	/** ISO. Só em "congelado". */
	congeladoEm?: string;
	versaoCalculo?: number;
	/**
	 * Existe um recálculo mais novo guardado (outra versão de cálculo)?
	 * A tela mostra o ORIGINAL — correção se anuncia, não se aplica por baixo.
	 */
	recalculoDisponivel?: number | null;
	/** A fonte mudou depois do congelamento? */
	divergenteDaFonte?: boolean;
	/** O JSON guardado ainda bate com o próprio hash? `false` = adulterado. */
	integro?: boolean;
	/** O que exatamente está congelado — a tela não deve prometer mais que isso. */
	abrangencia?: string;
}

// ─── Dashboard consolidado ────────────────────────────────────────
export interface DashboardData {
	gestaoAtual: PeriodoGestao;
	periodoSelecionado: {
		tipo: "gestao" | "ciclo" | "mes";
		valor: string;
	};
	vendas: KPIsVendas;
	porCoordenacao: KPIsPorCoordenacao[];
	/**
	 * Projetos em negociação que não caem em nenhuma linha de `porCoordenacao`
	 * — campo "Coordenação" em branco no Pipefy, ou preenchido com um valor
	 * fora das cinco. Existe para que a soma das linhas poder ser menor que o
	 * board seja um fato escrito, e não uma diferença que ninguém explica.
	 */
	negociacoesSemCoordenacao: {
		quantidade: number;
		valor: number;
		rotulos: string[];
	};
	porVendedor: KPIsPorVendedor[];
	porCanal: { canal: string; totalVendido: number; numeroDeVendas: number }[];
	vendasPorMes: {
		mes: string;
		label: string;
		totalVendido: number;
		numeroDeVendas: number;
	}[];
	ltv: KPILTV;
	comparativo: {
		gestaoAtual: KPIsVendas;
		gestaoAnterior: KPIsVendas | null;
	};
	/**
	 * Quando a FONTE foi lida pela última vez com sucesso — não quando esta
	 * resposta foi gerada.
	 *
	 * Era `new Date()`, a hora da requisição. Com o cron parado por dez horas a
	 * tela anunciava "atualizado agora", e o único lugar onde a falha apareceria
	 * dizia o contrário do que acontecia. `null` = nunca houve carga.
	 */
	ultimaAtualizacao: string | null;
	/** Nome da fonte a que `ultimaAtualizacao` se refere — a mais atrasada. */
	fonteMaisAtrasada: string | null;
	/** Detalhe por fonte, para o tooltip poder abrir o quadro completo. */
	frescor: {
		fonteRef: string;
		tipo: "pipefy" | "planilha";
		nome: string;
		ultimaCarga: string | null;
		horasDesdeAUltima: number | null;
		atraso: number;
	}[];
	dadoVelho: boolean;
	comparativoAnalitico: ComparativoAnalitico;
	origemDosNumeros: OrigemDosNumeros;
}

// ─── Tipos auxiliares ─────────────────────────────────────────────
export interface ComparativoAnalitico {
	periodoAtual: {
		descricao: string;
		totalMeses: number;
		totalVendido: number;
		numeroDeVendas: number;
		ticketMedio: number;
		taxaConversao: number;
	};
	periodoEquivalente: {
		descricao: string;
		totalMeses: number;
		totalVendido: number;
		numeroDeVendas: number;
		ticketMedio: number;
		taxaConversao: number;
	} | null;
	variacoes: {
		totalVendido: number;
		numeroDeVendas: number;
		ticketMedio: number;
		taxaConversao: number;
	} | null;
	linear: {
		metaAnual: number;
		mesesDecorridos: number;
		totalMeses: number;
		metaLinear: number;
		realizado: number;
		variacao: number;
		adiantamento: number;
		projecaoAnual: number;
	};
}

// ─── Funil novo (Supabase / calculations-funil.ts) ───────────────

export type CoordenacaoOuND = Coordenacao; // ND removido — cards sem coord válida são excluídos dos breakdowns

export interface EtapaConversao {
	etapa: EtapaFunil;
	quantidade: number;
	/**
	 * A fase não existia no pipe que originou estes cards — ninguém passou por
	 * ela porque ela não estava lá. É DIFERENTE de conversão zero, e por isso não
	 * tem percentual: a tela mostra "—", nunca "0%".
	 */
	naoInstrumentada?: boolean;
	// Acumulada: % de cards que alcançaram esta fase em relação a "Contato aberto" (base 100%).
	// Monotônica decrescente. undefined = pré-funil (Oportunidade).
	percentualRelativo?: number;
	// Etapa-a-etapa: % de cards que vieram da fase imediatamente anterior.
	// undefined em Oportunidade (pré-funil) e na etapa base (sem fase anterior).
	percentualEtapaAnterior?: number;
	/**
	 * Contra QUAL etapa o `percentualEtapaAnterior` foi calculado.
	 *
	 * Nem sempre é a etapa imediatamente anterior da lista: quando a anterior não
	 * era instrumentada, o cálculo pula o buraco. Dois períodos podem então ter
	 * percentuais com bases diferentes — "Pré-diagnóstico" medido contra
	 * "Oportunidade" num lado e contra "Contato aberto" no outro. Subtrair os
	 * dois produz um delta que parece uma queda de conversão e é só troca de
	 * denominador. O comparador usa este campo para se recusar a fazer a conta.
	 */
	baseEtapaAnterior?: EtapaFunil;
}

export interface KPIsFunilConversao {
	etapas: EtapaConversao[];
	/** Cards na etapa-base (Oportunidade) — o 100% dos percentuais acumulados. */
	totalBase: number;
}

export interface KPIsFunilCompleto {
	geral: {
		conversao: KPIsFunilConversao;
		tempo: KPIsFunilTempo;
	};
	porCoordenacao: Record<
		Coordenacao,
		{
			conversao: KPIsFunilConversao;
			tempo: KPIsFunilTempo;
		}
	>;
}

// ─── Comparador periódico de funil (F1) ─────────────────────────
//
// Compara o funil de DUAS coortes (períodos) lado a lado.
// Semântica: coorte fechada — cards CRIADOS na janela, medidos via histórico
// congelado em observarAte (ver calculations-funil.ts). A "janela equalizada"
// alinha os dois períodos pela mesma idade (primeiros H dias de cada um),
// tornando justa a comparação contra um período ainda em andamento.

export interface SelecaoPeriodoFunil {
	tipo: "gestao" | "ciclo" | "mes";
	gestao: PeriodoGestao;
	ciclo?: PeriodoCiclo;
	mes?: string;
}

export interface FunilVolume {
	criados: number; // todos os cards criados na janela (comercial + entrada direta)
	entraramFunil: number; // comerciais que alcançaram "Contato aberto"
	chegaramVenda: number; // comerciais que alcançaram "Venda"
	conversaoTopoVenda: number; // chegaramVenda / entraramFunil * 100
}

export interface MaturidadeCoorte {
	emAndamento: boolean; // a janela ainda não fechou (fim > hoje)
	emMaturacao: boolean; // fechou há pouco (< limiar) → coorte ainda imatura
	diasDecorridos: number; // dias desde o início até hoje (ou até o fim, se já fechou)
}

export interface FunilPeriodo {
	selecao: SelecaoPeriodoFunil;
	janela: { inicioISO: string; criadoAteISO: string; observarAteISO: string };
	conversao: KPIsFunilConversao;
	tempo: KPIsFunilTempo;
	volume: FunilVolume;
	maturidade: MaturidadeCoorte;
	/**
	 * Trecho do período em que NÃO havia CRM no ar; `null` quando coberto.
	 *
	 * Não é o mesmo que "não houve venda". Out–dez/2023 não tem funil porque o
	 * Pipefy antigo só começa em 18/12/2023 — as vendas desse trecho estão nas
	 * planilhas, mas o caminho até elas não foi registrado por ninguém. Sem este
	 * campo, o comparador mostraria "o funil encolheu" para um funil que não
	 * existia.
	 */
	coberturaParcial: {
		texto: string;
		diasSemFunil: number;
		diasDoPeriodo: number;
	} | null;
}

export interface DeltaEtapaFunil {
	etapa: EtapaFunil;
	// b − a, em pontos percentuais / horas. undefined quando a métrica não se aplica.
	deltaPercentualRelativo?: number;
	deltaPercentualEtapaAnterior?: number;
	deltaTempoHoras?: number;
}

// Descreve como os dois períodos foram alinhados na janela equalizada.
//   modo "completo"  → ambos finalizados: usa o período inteiro de cada lado
//                      (sem truncar). `valor` é ignorado.
//   modo "parcial"   → algum lado em andamento: trunca os dois ao decorrido do
//                      período em andamento, em `valor` `unidade` (ex.: 29 dias).
// `unidade` segue o tipo do período: mês → "dias"; ciclo/gestão → "meses".
export interface JanelaEqualizada {
	modo: "completo" | "parcial";
	valor: number;
	unidade: "dias" | "meses";
}

export interface ComparativoFunilPeriodos {
	a: FunilPeriodo;
	b: FunilPeriodo;
	deltaEtapas: DeltaEtapaFunil[];
	deltaVolume: FunilVolume; // b − a campo a campo
	equalizado: boolean;
	janelaEqualizada: JanelaEqualizada | null; // null = sem equalização
}

export interface ComparadorFasesResultado {
	etapaDe: EtapaFunil;
	etapaPara: EtapaFunil;
	totalNaEtapaDe: number;
	chegaramNaEtapaPara: number;
	percentual: number;
	/**
	 * Etapas escolhidas que o pipe de origem não instrumentava.
	 * Quando presente, os números acima são zero por AUSÊNCIA DE MEDIÇÃO — não
	 * por conversão nula. A UI precisa dizer isso; mostrar 0,0% seria mentira.
	 */
	naoInstrumentadas?: EtapaFunil[];
}

export interface KPIsEntradaDireta {
	porCoordenacao: Record<
		Coordenacao,
		{
			quantidade: number;
			valorTotal: number;
		}
	>;
	totalGeral: {
		quantidade: number;
		valorTotal: number;
	};
}
