// src/lib/fontes/tipos.ts
//
// Tipos do registry de fontes (F1 do PLANO-FONTE-DA-VERDADE.md, plano histórico, no repositório privado de arquivo).
//
// O registry declara, por gestão, ONDE está cada dado e COMO lê-lo. O objetivo é
// que adicionar a gestão 26/27 seja uma entrada de configuração, não código novo.
//
// `IdGestao` é `string` de propósito: o tipo literal fechado
// (`"24/25" | "25/26"` em src/types) é justamente o que a F2 vai remover, e o
// registry precisa comportar 23/24 desde já.

/** Rótulo de gestão no formato "AA/BB", com BB = AA + 1. */
export type IdGestao = string;

/** Campos canônicos de um contrato assinado, unificando as três planilhas. */
export type CampoContrato =
	| "mes"
	| "projeto"
	| "contratante"
	| "responsavel1"
	| "responsavel2"
	| "responsavel3"
	| "responsavel4"
	| "assinado"
	| "coordenacao"
	| "itemDaCarta"
	| "prazo"
	| "valorVendidoReal"
	| "valorContrato"
	| "dataAssinatura"
	| "dataEntrega"
	| "precoPorSemana"
	| "numeroParcelas"
	| "canalAquisicao"
	| "fidelizacao"
	| "compiladoNoPortal";

/**
 * Como encontrar uma coluna.
 *
 * `cabecalho` é a regra. `posicao` é a exceção — existe porque a coluna do mês
 * não tem cabeçalho utilizável em nenhuma das três planilhas (vazio em 23/24 e
 * 24/25; o placeholder "Coluna 1" em 25/26). Toda exceção exige `motivo`, para
 * que ninguém a use por comodidade.
 */
export type LocalizadorColuna =
	| { tipo: "cabecalho"; nome: string }
	| { tipo: "posicao"; indice: number; motivo: string };

export interface FonteTabela {
	estrategia: "tabela";
	spreadsheetId: string;
	aba: string;
	/** Linha do cabeçalho, 1-based. */
	linhaCabecalho: number;
	colunas: Partial<Record<CampoContrato, LocalizadorColuna>>;
	/**
	 * Campos sem os quais a linha não descreve um contrato que aconteceu.
	 *
	 * Valem em dois níveis: se a COLUNA não existir na aba, a leitura falha alto;
	 * se a coluna existir mas a LINHA estiver sem valor, a linha é descartada com
	 * motivo (ver `LinhaDescartada`).
	 *
	 * Regra do dono do processo: são `projeto` (sem nome não dá para identificar
	 * o que foi assinado), `mes` (sem data não entra em período nenhum) e
	 * `coordenacao` (sem ela, não dá para afirmar que o projeto aconteceu).
	 * As colunas de VALOR ficam de fora de propósito: contrato assinado sem valor
	 * preenchido é contrato — entra com zero.
	 */
	obrigatorios: CampoContrato[];
}

/** Um ciclo da gestão. Duração e nome variam por gestão — são decisão dela. */
export interface Ciclo {
	/** Estável, usado como chave em `meta.periodo`. Ex.: "waterloo". */
	id: string;
	/** Como a empresa chama. Ex.: "Ciclo Waterloo". */
	rotulo: string;
	/** Mês inicial, "01".."12". */
	mesInicio: string;
	/** Mês final, "01".."12". Pode ser menor que mesInicio (ciclo vira o ano). */
	mesFim: string;
	/**
	 * O nome ainda não foi revelado pela gestão.
	 *
	 * Os ciclos só ganham nome quando chegam a vez deles — até lá a planilha usa
	 * placeholder ("Ciclo XXX"). Uma gestão nova pode entrar no registry com os
	 * ciclos todos provisórios, e o casamento continua funcionando porque é feito
	 * pela data FIM, não pelo nome.
	 *
	 * Com esta marca, quando a planilha revelar o nome real a ingestão avisa para
	 * atualizar o registry, em vez de tratar a diferença como erro.
	 */
	rotuloProvisorio?: boolean;
}

/**
 * Fonte de metas: a aba "Metas por coordenação", que é um painel espacial e não
 * uma tabela. Ver `blocos.ts` para o layout.
 *
 * As colunas são declaradas por índice porque não existe cabeçalho nenhum para
 * casar — é a natureza da aba, não uma escolha de conveniência.
 */
export interface FonteBlocos {
	estrategia: "blocos";
	spreadsheetId: string;
	aba: string;
	/** Coluna dos blocos "METAS" e "GESTÃO" (0-based; B = 1 nas três planilhas). */
	colunaBlocosB: number;
	/** Coluna dos blocos de ciclo (0-based; E = 4 nas três planilhas). */
	colunaBlocosCiclo: number;
	/** Rótulo que inicia o bloco de metas mensais. */
	ancoraMensal: string;
	/**
	 * Rótulo que encerra o bloco mensal e carrega a meta de gestão da Fluxo.
	 * Sem este corte, o bloco "PROJETADO REALISTA" de 23/24 — logo abaixo, na
	 * mesma coluna, com os mesmos meses — seria lido como se fosse meta.
	 */
	ancoraFimMensal: string;
	/** Rótulo do bloco de metas de gestão por coordenação. Só 25/26 tem. */
	ancoraGestao?: string;
	/** Prefixo que marca o início de um bloco de ciclo. */
	prefixoCiclo: string;
}

export interface Gestao {
	id: IdGestao;
	/** Ano civil em que a gestão começa (out). "24/25" → 2024. */
	anoInicio: number;
	ciclos: Ciclo[];
	/** Fonte dos contratos assinados. */
	contratos: FonteTabela;
	/** Fonte das metas. */
	metas?: FonteBlocos;
	/**
	 * Gestão encerrada não muda mais: só o backfill a lê, o cron a ignora.
	 * Derivado da data em vez de declarado — ver `gestaoEstaAtiva`.
	 */
	observacoes?: string[];
}

// ─── Resultado da leitura ─────────────────────────────────────────

export interface LinhaTabela {
	/** Campo canônico → valor bruto da célula (string, como a planilha exibe). */
	valores: Partial<Record<CampoContrato, string>>;
	/** Linha na planilha, 1-based — a mesma que aparece na barra lateral do Sheets. */
	linhaPlanilha: number;
	/** Linhagem, no formato que a F5 vai gravar em `origem_ref`. */
	origemRef: string;
}

/**
 * Linha que parecia um registro mas não pôde virar dado.
 *
 * Antecipa a `ingestao_rejeicao` da F5: o objetivo é que nenhum descarte seja
 * silencioso. Uma linha que some sem explicação é indistinguível de um bug.
 */
export interface LinhaDescartada {
	linhaPlanilha: number;
	origemRef: string;
	motivo: string;
	camposFaltando: CampoContrato[];
	/** Payload bruto do que havia na linha, para diagnóstico. */
	valores: Partial<Record<CampoContrato, string>>;
}

export interface TabelaLida {
	gestao: IdGestao;
	spreadsheetId: string;
	aba: string;
	/** Linhas aceitas: todos os campos obrigatórios preenchidos. */
	linhas: LinhaTabela[];
	/** Linhas com substância mas faltando obrigatório — merecem atenção humana. */
	descartadas: LinhaDescartada[];
	/** Linhas sem substância: ruído estrutural da planilha, apenas contado. */
	ignoradas: number;
	/** Colunas resolvidas: campo → índice 0-based. Útil para diagnóstico. */
	resolucao: Partial<Record<CampoContrato, number>>;
}
