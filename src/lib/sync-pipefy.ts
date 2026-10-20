// src/lib/sync-pipefy.ts
//
// Sincronização do Pipefy com o Supabase, pelo registry de pipes.
//
// ESCOPO: o cron varre só os pipes ativos; o backfill varre todos. O pipe antigo
// está encerrado (1606 dos 1608 cards em estado terminal, nenhum novo desde
// 27/06/2025) — revarrê-lo a cada 30 minutos seria reler dado imutável.
//
// As constantes de fase e de campo saíram daqui. Existiam duas cópias, uma neste
// arquivo e outra em scripts/backfill-pipefy.ts, mantidas em sincronia à mão.
// Agora há uma definição só, em src/lib/fontes/pipes.ts.

import { createClient } from "@supabase/supabase-js";

import {
	buscarPipe,
	campoCasa,
	faseIgnorada,
	pipesDoCron,
	resolverFase,
	todosOsPipes,
	type CampoCard,
	type MapaPipe,
} from "@/lib/fontes/pipes";
import { normalizarNomeVendedor } from "@/lib/fontes/mapear";
import { apenasCoordenacoes } from "@/lib/coordenacoes";
import {
	abrirExecucao,
	type DisparadoPor,
	type Execucao,
} from "@/lib/ingestao/registro";

function getSupabase() {
	return createClient(
		process.env.SUPABASE_URL!,
		process.env.SUPABASE_SERVICE_ROLE_KEY!,
	);
}

const PIPEFY_API_URL = "https://api.pipefy.com/graphql";

// ─── Tipos ────────────────────────────────────────────────────────

interface PhaseHistory {
	phase: { name: string };
	firstTimeIn: string;
	lastTimeOut: string | null;
}

export interface CampoDoCard {
	field: { label: string };
	value?: string;
	array_value?: string[];
}

interface PipefyCardRaw {
	id: string;
	title: string;
	current_phase: { name: string };
	createdAt: string;
	updated_at: string;
	fields: CampoDoCard[];
	phases_history: PhaseHistory[];
}

export interface ResultadoPipe {
	pipeId: string;
	nome: string;
	execucao: number | null;
	inseridos: number;
	erros: number;
	reconciliados: number;
	rejeicoes: { origemRef: string; motivo: string }[];
}

export interface ResultadoSyncPipefy {
	porPipe: ResultadoPipe[];
	totais: { inseridos: number; erros: number; rejeicoes: number };
}

// ─── API ──────────────────────────────────────────────────────────

async function fetchPipefy<T>(query: string): Promise<T> {
	const token = process.env.PIPEFY_TOKEN;
	if (!token) throw new Error("PIPEFY_TOKEN é obrigatório no ambiente.");

	const response = await fetch(PIPEFY_API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ query }),
	});

	if (!response.ok) throw new Error(`Pipefy API error: ${response.status}`);

	const json = (await response.json()) as {
		data: T;
		errors?: { message: string }[];
	};
	if (json.errors?.length)
		throw new Error(`Pipefy GraphQL: ${json.errors[0].message}`);

	return json.data;
}

function queryFases(pipeId: string): string {
	return `query { pipe(id: ${pipeId}) { phases { id name } } }`;
}

function queryCardsDaFase(phaseId: string, cursor?: string): string {
	const after = cursor ? `, after: "${cursor}"` : "";
	return `query {
    phase(id: "${phaseId}") {
      name
      cards(first: 30${after}) {
        edges { node {
          id title
          current_phase { name }
          createdAt updated_at
          fields { field { label } value array_value }
          phases_history { phase { name } firstTimeIn lastTimeOut }
        } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;
}

// ─── Extração de campos ───────────────────────────────────────────

/**
 * Valores de um campo, casando o label pelo MAPA DO PIPE.
 *
 * `value` MANDA; `array_value` só entra quando `value` não existe.
 *
 * A versão anterior somava os dois, com o comentário de que "multi-select põe
 * os labels em array_value". É o contrário, e vale para todo tipo de campo que
 * este projeto lê:
 *
 *     label_select     value="[\"PRO\", \"MNP\"]"   array_value=["316102076","316102077"]
 *     assignee_select  value="[\"Ana Souza\"]"  array_value=["100000001"]
 *     select/short_text value="Passiva Orgânica"    array_value=null
 *
 * `array_value` são IDs internos do Pipefy. Somá-los aos labels contaminou o
 * banco inteiro, e o estrago não parecia um bug — parecia dado:
 *
 *   · `coordenacoes` virou ["316102076","PRO"] em 2887 dos 2930 cards, então
 *     `coordenacoes.length > 1` (o teste de cross-sell) passou a ser verdadeiro
 *     para 98,5% do board e o cross-sell REAL, que existe em 86 cards, ficou
 *     indistinguível do ruído;
 *   · `coordenacao` (singular) = `coordenacoes[0]` virou um ID numérico;
 *   · cada ID de responsável virou um "vendedor" no banco — 61 fantasmas e
 *     3.398 dos 6.796 vínculos card–vendedor apontando para eles.
 *
 * Nenhum desses erros produz exceção: produz número plausível. Por isso a
 * precedência é explícita aqui em vez de "combinar os dois e torcer".
 */
// Exportada só para teste: a precedência value > array_value é um fato sobre o
// payload do Pipefy, não uma escolha de estilo, e custou o banco inteiro.
export function extrairValores(
	pipe: MapaPipe,
	fields: CampoDoCard[],
	campo: CampoCard,
): string[] {
	const encontrados = fields.filter((f) =>
		campoCasa(pipe, campo, f.field?.label ?? ""),
	);
	if (encontrados.length === 0) return [];

	const resultados: string[] = [];
	for (const f of encontrados) {
		if (f.value) {
			try {
				const parsed = JSON.parse(f.value);
				if (Array.isArray(parsed)) resultados.push(...parsed.filter(Boolean));
				else resultados.push(f.value);
			} catch {
				resultados.push(f.value);
			}
			continue;
		}
		// Sem `value` não há label para ler. `array_value` entra como último
		// recurso: melhor um ID visível do que um campo que some.
		if (f.array_value?.length) resultados.push(...f.array_value.filter(Boolean));
	}
	return [...new Set(resultados.map((v) => v.trim()).filter(Boolean))];
}

function extrairUm(
	pipe: MapaPipe,
	fields: CampoDoCard[],
	campo: CampoCard,
): string | null {
	return extrairValores(pipe, fields, campo)[0] ?? null;
}

function parsearValor(valor?: string | null): number {
	if (!valor) return 0;
	const limpo = valor.replace(/[R$\s.]/g, "").replace(",", ".");
	return parseFloat(limpo) || 0;
}


// ─── Vendedores ───────────────────────────────────────────────────

const cacheVendedores: Record<string, number> = {};

async function upsertVendedor(nome: string): Promise<number | null> {
	const nomeNormalizado = normalizarNomeVendedor(nome);
	if (!nomeNormalizado) return null;

	if (cacheVendedores[nomeNormalizado] !== undefined) {
		return cacheVendedores[nomeNormalizado];
	}

	const { data, error } = await getSupabase()
		.from("vendedor")
		.upsert({ nome_vendedor: nomeNormalizado }, { onConflict: "nome_vendedor" })
		.select("id_vendedor")
		.single();

	if (error || !data) {
		console.error(
			`[SyncPipefy] Erro ao upsert vendedor "${nomeNormalizado}":`,
			error?.message,
		);
		return null;
	}

	cacheVendedores[nomeNormalizado] = data.id_vendedor;
	return data.id_vendedor;
}

// ─── Um card ──────────────────────────────────────────────────────

/**
 * Grava um card. Devolve "ok" ou "rejeitado"; ERRO DE ESCRITA VIRA EXCEÇÃO.
 *
 * A versão anterior devolvia boolean para as duas coisas, e o chamador contava
 * `false` como erro — então um card com fase desconhecida (problema da FONTE)
 * entrava na mesma conta de um card que não pôde ser gravado (problema NOSSO).
 * São coisas diferentes: a primeira se resolve no Pipefy, a segunda repetindo a
 * carga.
 *
 * Erro de escrita sobe como exceção porque agora existe retentativa: só dá para
 * repetir o que se sabe que falhou.
 */
async function processarCard(
	pipe: MapaPipe,
	card: PipefyCardRaw,
	execucao: Execucao,
): Promise<"ok" | "rejeitado"> {
	const supabase = getSupabase();
	const origemRef = `${pipe.pipeId}#${card.id}`;

	const fase = resolverFase(pipe, card.current_phase.name);
	if (!fase) {
		// Fase desconhecida vira REJEIÇÃO, não descarte calado. É assim que se
		// descobre que alguém renomeou uma fase no Pipefy, em vez de ver o funil
		// encolher sem explicação.
		execucao.rejeitar({
			origemRef,
			motivo: `fase não mapeada no pipe "${pipe.nome}": "${card.current_phase.name}"`,
			campo: "etapa_atual",
			payload: { titulo: card.title, fase: card.current_phase.name },
		});
		return "rejeitado";
	}

	// O array fica CRU (só com os rótulos, sem os IDs): "NP", "AN" e afins são o
	// que a fonte disse, e filtrar aqui esconderia o preenchimento errado no
	// Pipefy em vez de expô-lo. Quem decide o que conta é a leitura.
	const coordenacoes = extrairValores(pipe, card.fields, "coordenacao")
		.map((c) => c.trim().toUpperCase())
		.filter(Boolean);

	const responsaveis = extrairValores(pipe, card.fields, "responsavel")
		.map((r) => r.trim())
		.filter(Boolean);

	// O último valor preenchido de "Valor da proposta" é o vigente.
	const valores = extrairValores(pipe, card.fields, "valorProposta").map(
		parsearValor,
	);
	const valorContrato = valores.length > 0 ? valores[valores.length - 1] : null;

	const { data: cardInserido, error: erroCard } = await supabase
		.from("card")
		.upsert(
			{
				pipefy_id: card.id,
				// Procedência: define qual mapa interpreta este card na leitura.
				pipe_id: pipe.pipeId,
				nome_card: card.title,
				data_criacao: card.createdAt,
				data_last_update: card.updated_at,
				// A PRIMEIRA RECONHECIDA, não a primeira do array. Com IDs
				// misturados, `coordenacoes[0]` era um número em 2887 cards; mesmo
				// sem eles, um card com ["NP","ACE"] gravaria "NP" como principal.
				coordenacao: apenasCoordenacoes(coordenacoes)[0] ?? null,
				coordenacoes,
				valor_contrato: valorContrato,
				canal_aquisicao: extrairUm(pipe, card.fields, "canalAquisicao"),
				etapa_atual: fase.canonica,
			},
			{ onConflict: "pipefy_id" },
		)
		.select("id_card")
		.single();

	if (erroCard || !cardInserido) {
		throw new Error(
			`gravar card "${card.title}" (${origemRef}): ${erroCard?.message}`,
		);
	}

	const idCard = cardInserido.id_card;

	const transicoes: { id_card: number; etapa: string; timestamp: string }[] = [];
	for (const ph of card.phases_history) {
		if (!ph.firstTimeIn) continue;
		if (faseIgnorada(pipe, ph.phase.name)) continue;

		const resolvida = resolverFase(pipe, ph.phase.name);
		if (!resolvida) {
			execucao.rejeitar({
				origemRef,
				motivo: `fase não mapeada no HISTÓRICO do pipe "${pipe.nome}": "${ph.phase.name}"`,
				campo: "funil.etapa",
				payload: { titulo: card.title, fase: ph.phase.name },
			});
			continue;
		}
		transicoes.push({
			id_card: idCard,
			etapa: resolvida.canonica,
			timestamp: ph.firstTimeIn,
		});
	}

	// Histórico reinserido inteiro: é mais simples e mais correto que tentar
	// diferenciar transições, e o volume por card é pequeno.
	//
	// O DELETE só acontece agora, depois de `transicoes` estar montado — antes
	// vinha primeiro, e o erro do INSERT era só um console.error seguido de
	// `return true`. Uma oscilação de rede naquele instante apagava o histórico
	// do card, não gravava o novo, e a rodada contava o card como gravado com
	// sucesso. Perda silenciosa, invisível até alguém reparar num funil menor.
	if (transicoes.length > 0) {
		const { error: erroDelete } = await supabase
			.from("funil")
			.delete()
			.eq("id_card", idCard);
		if (erroDelete) {
			throw new Error(
				`limpar histórico de ${origemRef}: ${erroDelete.message}`,
			);
		}

		const { error: erroFunil } = await supabase.from("funil").insert(transicoes);
		if (erroFunil) {
			throw new Error(
				`inserir histórico de ${origemRef}: ${erroFunil.message}`,
			);
		}
	}

	// Substitui os vínculos — ver a nota equivalente em sync-sheets.ts.
	const vinculos: { id_card: number; id_vendedor: number }[] = [];
	for (const nome of responsaveis) {
		const idVendedor = await upsertVendedor(nome);
		if (!idVendedor) continue;
		if (vinculos.some((v) => v.id_vendedor === idVendedor)) continue;
		vinculos.push({ id_card: idCard, id_vendedor: idVendedor });
	}

	const { error: erroDeleteVinc } = await supabase
		.from("card_vendedor")
		.delete()
		.eq("id_card", idCard);
	if (erroDeleteVinc) {
		throw new Error(
			`limpar vínculos de ${origemRef}: ${erroDeleteVinc.message}`,
		);
	}

	if (vinculos.length > 0) {
		const { error: erroVinc } = await supabase
			.from("card_vendedor")
			.insert(vinculos);
		if (erroVinc) {
			throw new Error(`vincular vendedores de ${origemRef}: ${erroVinc.message}`);
		}
	}

	return "ok";
}

/**
 * Repete uma operação que falhou por rede.
 *
 * Cargas completas fazem milhares de requisições sequenciais, e as falhas
 * observadas em 11/08/2026 se concentravam no FIM da varredura — assinatura de
 * esgotamento de socket, não de banco fora do ar. Uma delas perdeu 730 de 1235
 * cards; outra, 40.
 *
 * Espera crescente entre as tentativas justamente porque a causa é saturação:
 * repetir imediatamente empurra mais requisição no gargalo que já estourou.
 *
 * Não engole nada — esgotadas as tentativas, o erro sobe e é contado.
 */
async function comRetentativa<T>(
	descricao: string,
	fn: () => Promise<T>,
	tentativas = 3,
): Promise<T> {
	let ultimo: unknown;
	for (let i = 1; i <= tentativas; i++) {
		try {
			return await fn();
		} catch (erro) {
			ultimo = erro;
			if (i < tentativas) {
				const espera = 500 * 2 ** (i - 1);
				console.warn(
					`[SyncPipefy] ${descricao} falhou (tentativa ${i}/${tentativas}): ` +
						`${(erro as Error)?.message}. Repetindo em ${espera}ms.`,
				);
				await new Promise((r) => setTimeout(r, espera));
			}
		}
	}
	throw ultimo;
}

// ─── Um pipe ──────────────────────────────────────────────────────

async function sincronizarPipe(
	pipe: MapaPipe,
	disparadoPor: DisparadoPor,
	opcoes: { incluirTerminais: boolean; forcar: boolean },
): Promise<ResultadoPipe> {
	const rejeicoes: { origemRef: string; motivo: string }[] = [];

	const execucao = await abrirExecucao({
		fonteTipo: "pipefy",
		fonteRef: pipe.pipeId,
		disparadoPor,
	});

	// Envolve a rejeição para alimentar os dois destinos de uma vez.
	const execucaoComEco: Execucao = {
		...execucao,
		get id() {
			return execucao.id;
		},
		get rejeicoes() {
			return execucao.rejeicoes;
		},
		rejeitar: (r) => {
			rejeicoes.push({ origemRef: r.origemRef, motivo: r.motivo });
			execucao.rejeitar(r);
		},
		rejeitarVarias: (rs) => {
			for (const r of rs) execucaoComEco.rejeitar(r);
		},
	};

	try {
		const data = await fetchPipefy<{
			pipe: { phases: { id: string; name: string }[] | null };
		}>(queryFases(pipe.pipeId));
		const todasFases: { id: string; name: string }[] = data.pipe.phases ?? [];

		const paraProcessar = todasFases.filter((f) => {
			if (faseIgnorada(pipe, f.name)) return false;

			const resolvida = resolverFase(pipe, f.name);
			if (resolvida) return opcoes.incluirTerminais || !resolvida.terminal;

			// Fase que o pipe tem e o mapa não conhece: aparece no relatório.
			execucaoComEco.rejeitar({
				origemRef: `${pipe.pipeId}#fase:${f.id}`,
				motivo: `fase do pipe "${pipe.nome}" ausente do MapaPipe: "${f.name}"`,
				campo: "fase",
				payload: { fase: f.name, phaseId: f.id },
			});
			return false;
		});

		const cards: PipefyCardRaw[] = [];
		for (const fase of paraProcessar) {
			let cursor: string | undefined;
			let temMais = true;
			while (temMais) {
				const d = await fetchPipefy<{
					phase: {
						cards: {
							edges: { node: PipefyCardRaw }[] | null;
							pageInfo: { hasNextPage: boolean; endCursor?: string } | null;
						} | null;
					} | null;
				}>(queryCardsDaFase(fase.id, cursor));
				const bloco = d.phase?.cards;
				if (!bloco) break;
				for (const e of bloco.edges ?? []) cards.push(e.node);
				temMais = bloco.pageInfo?.hasNextPage ?? false;
				cursor = bloco.pageInfo?.endCursor;
			}
		}

		// Quando o cron roda, só interessa o que MUDOU. Uma consulta paginada
		// resolve: `data_last_update` é gravado a partir do `updated_at` do
		// Pipefy, então comparar os dois diz exatamente quais cards têm novidade.
		const jaGravado = new Map<string, string | null>();
		if (!opcoes.forcar) {
			const supabase = getSupabase();
			for (let inicio = 0; ; inicio += 1000) {
				const { data, error } = await supabase
					.from("card")
					.select("pipefy_id, data_last_update")
					.eq("pipe_id", pipe.pipeId)
					.order("id_card", { ascending: true })
					.range(inicio, inicio + 999);
				if (error || !data) break;
				for (const r of data) jaGravado.set(r.pipefy_id, r.data_last_update);
				if (data.length < 1000) break;
			}
		}

		const mesmoInstante = (a: string | null, b: string | null) =>
			a !== null && b !== null && new Date(a).getTime() === new Date(b).getTime();

		let inseridos = 0;
		let erros = 0;
		let rejeitados = 0;
		let inalterados = 0;
		for (const card of cards) {
			if (
				!opcoes.forcar &&
				jaGravado.has(card.id) &&
				mesmoInstante(jaGravado.get(card.id) ?? null, card.updated_at)
			) {
				inalterados++;
				continue;
			}
			try {
				const r = await comRetentativa(`card ${card.id}`, () =>
					processarCard(pipe, card, execucaoComEco),
				);
				if (r === "ok") inseridos++;
				else rejeitados++;
			} catch (erro) {
				// Card que não pôde ser gravado nem depois das retentativas. Conta
				// como ERRO (problema nosso, resolve repetindo a carga), nunca como
				// rejeição (problema da fonte, resolve no Pipefy).
				console.error(
					`[SyncPipefy] Desisti de "${card.title}": ${(erro as Error)?.message}`,
				);
				erros++;
			}
		}

		const reconciliados = await reconciliarOrfaos(
			pipe,
			new Set(cards.map((c) => c.id)),
			opcoes.incluirTerminais,
		);

		await execucao.finalizar({
			lidas: cards.length,
			aceitas: inseridos,
			// Card sem novidade na origem: lido, não reescrito. Entra em
			// `ignoradas` para a identidade lidas = aceitas + rejeitadas +
			// ignoradas continuar fechando.
			ignoradas: inalterados,
			// Só as rejeições de CARD. As de transição ficam em ingestao_rejeicao
			// e não entram nesta conta — ver a nota em Contagens.rejeitadas.
			rejeitadas: rejeitados,
			removidas: reconciliados,
			erros,
		});

		return {
			pipeId: pipe.pipeId,
			nome: pipe.nome,
			execucao: execucao.id,
			inseridos,
			erros,
			reconciliados,
			rejeicoes,
		};
	} catch (erro) {
		await execucao.falhar(erro);
		throw erro;
	}
}

/**
 * Corrige cards que sumiram da varredura: foram para uma fase não varrida ou
 * arquivados. Sem isto ficam congelados na última fase vista e inflam o funil.
 *
 * ESCOPADO POR PIPE. Com dois pipes no banco, uma reconciliação global apagaria
 * os cards do outro pipe só por ele não ter sido varrido nesta rodada.
 *
 * EXCETO os cards SEM `pipe_id`, que o pipe ativo adota. Eles são herança do
 * webhook antigo, que gravava sem procedência — e como o escopo é por pipe, um
 * card com `pipe_id` nulo não caía no escopo de NINGUÉM. Ficava preso na última
 * fase vista para sempre, inflando o funil, sem nenhuma rodada capaz de
 * alcançá-lo. Foi assim que um rascunho de 07/08/2026 passou a contar como
 * oportunidade em "Contato aberto".
 *
 * Adotar é seguro porque nada é decidido aqui: `estadoAtualDoCard` pergunta ao
 * Pipefy antes. Card que sumiu é apagado, card que existe tem a fase corrigida
 * E a procedência preenchida. Só o pipe ativo adota — o encerrado não recebe
 * card novo, então um órfão nunca é dele.
 */
async function reconciliarOrfaos(
	pipe: MapaPipe,
	idsVistos: Set<string>,
	varreuTerminais: boolean,
): Promise<number> {
	const supabase = getSupabase();

	// Card já registrado como terminal, numa rodada que NÃO varreu fases
	// terminais, tem toda razão para não aparecer — ele não sumiu, não foi
	// procurado. Sem este recorte, o cron trataria os 1167 cards terminais do
	// pipe ativo como órfãos e perguntaria o estado de cada um ao Pipefy, um a
	// um: mil e cem requisições para descobrir que nada mudou. Seria mais lento
	// que a varredura completa que este corte veio evitar.
	const terminais = Object.values(pipe.fasesTerminais);

	// PAGINADO, e não é detalhe: o Supabase corta a resposta em 1000 linhas sem
	// erro nenhum. Sem paginar, a reconciliação do pipe antigo enxergava 1000 dos
	// 1608 cards — 608 nunca podiam ser corrigidos nem removidos, e nada acusava,
	// porque uma resposta truncada é indistinguível de uma tabela pequena.
	const noBanco: { id_card: number; pipefy_id: string }[] = [];
	for (let inicio = 0; ; inicio += 1000) {
		let consulta = supabase
			.from("card")
			.select("id_card, pipefy_id")
			// Sem ordem estável a paginação perde linhas — foi assim que o card
			// "Rascunho" sobreviveu a duas rodadas de reconciliação.
			.order("id_card", { ascending: true })
			.range(inicio, inicio + 999);

		if (!varreuTerminais) {
			consulta = consulta.not(
				"etapa_atual",
				"in",
				`(${terminais.map((t) => `"${t}"`).join(",")})`,
			);
		}

		const { data: lote, error } = await (pipe.encerrado
			? consulta.eq("pipe_id", pipe.pipeId)
			: consulta.or(`pipe_id.eq.${pipe.pipeId},pipe_id.is.null`));

		if (error || !lote) {
			console.error(
				`[SyncPipefy] Erro ao buscar cards de ${pipe.nome} para reconciliação:`,
				error?.message,
			);
			return 0;
		}

		noBanco.push(...lote);
		if (lote.length < 1000) break;
	}

	const orfaos = noBanco.filter((c) => !idsVistos.has(c.pipefy_id));
	if (orfaos.length === 0) return 0;

	console.log(
		`[SyncPipefy] ${pipe.nome}: ${orfaos.length} card(s) sumiram da varredura — verificando.`,
	);

	let corrigidos = 0;
	for (const orfao of orfaos) {
		const estado = await estadoAtualDoCard(orfao.pipefy_id);

		if (estado === "ARQUIVADO") {
			await supabase.from("funil").delete().eq("id_card", orfao.id_card);
			await supabase.from("card_vendedor").delete().eq("id_card", orfao.id_card);
			await supabase.from("card").delete().eq("id_card", orfao.id_card);
			corrigidos++;
			continue;
		}

		const fase = estado ? resolverFase(pipe, estado) : null;
		if (fase) {
			await supabase
				.from("card")
				// `pipe_id` junto: se o card veio sem procedência, é aqui que ele
				// ganha uma — e volta a ser alcançável pelas próximas rodadas.
				.update({ etapa_atual: fase.canonica, pipe_id: pipe.pipeId })
				.eq("id_card", orfao.id_card);
			corrigidos++;
		}
	}

	return corrigidos;
}

async function estadoAtualDoCard(
	pipefyId: string,
): Promise<string | null | "ARQUIVADO"> {
	try {
		const data = await fetchPipefy<{
			card: { current_phase: { name: string } | null } | null;
		}>(
			`query { card(id: ${pipefyId}) { current_phase { name } } }`,
		);
		return data?.card?.current_phase?.name ?? "ARQUIVADO";
	} catch {
		// Card deletado devolve erro do GraphQL — tratamos como arquivado.
		return "ARQUIVADO";
	}
}

// ─── Entrada pública ──────────────────────────────────────────────

export interface OpcoesSyncPipefy {
	/** Sem isto, usa o escopo do cron (só os pipes ativos). */
	pipes?: MapaPipe[];
	disparadoPor?: DisparadoPor;
	/**
	 * Varrer também as fases terminais (Perdido/Pausado/Venda).
	 *
	 * O BACKFILL varre tudo. O CRON não: no pipe ativo são 73 cards fora de fase
	 * terminal contra 1240 no total — varrer os terminais a cada 30 minutos é
	 * reler 94% de dado que não muda mais, e foi o que estourou o limite de
	 * execução da função serverless (504 FUNCTION_INVOCATION_TIMEOUT).
	 *
	 * Card que MUDA para terminal entre duas rodadas não se perde: ele deixa de
	 * aparecer na varredura e a reconciliação vai buscar o estado dele no Pipefy,
	 * um a um. É exatamente para isso que a reconciliação existe.
	 */
	incluirTerminais?: boolean;
	/**
	 * Reescrever card mesmo sem alteração na origem.
	 *
	 * O cron não: card cujo `updated_at` do Pipefy é o mesmo já gravado não tem
	 * nada de novo, e reescrevê-lo é apagar e reinserir o histórico inteiro para
	 * chegar ao mesmo resultado. Era o grosso dos 275s da rodada.
	 *
	 * O BACKFILL sim, sempre — é a ferramenta de reparo. Quando a interpretação
	 * do dado muda (foi o caso do `pipe_id`, que não existia), o `updated_at` da
	 * origem continua igual e só uma reescrita forçada conserta.
	 */
	forcar?: boolean;
}

export async function sincronizarPipefy(
	opcoes: OpcoesSyncPipefy = {},
): Promise<ResultadoSyncPipefy> {
	const pipes = opcoes.pipes ?? pipesDoCron();
	const porPipe: ResultadoPipe[] = [];

	for (const pipe of pipes) {
		console.log(`[SyncPipefy] Sincronizando ${pipe.nome} (${pipe.pipeId})...`);
		porPipe.push(
			await sincronizarPipe(pipe, opcoes.disparadoPor ?? "manual", {
				// Backfill e execução manual varrem tudo; o cron, só o que se move.
				incluirTerminais:
					opcoes.incluirTerminais ?? opcoes.disparadoPor !== "cron",
				forcar: opcoes.forcar ?? opcoes.disparadoPor !== "cron",
			}),
		);
	}

	const totais = porPipe.reduce(
		(acc, r) => ({
			inseridos: acc.inseridos + r.inseridos,
			erros: acc.erros + r.erros,
			rejeicoes: acc.rejeicoes + r.rejeicoes.length,
		}),
		{ inseridos: 0, erros: 0, rejeicoes: 0 },
	);

	return { porPipe, totais };
}

export { todosOsPipes, buscarPipe };
