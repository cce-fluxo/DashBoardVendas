// src/lib/sync-sheets.ts
//
// Sincronização das planilhas oficiais com o Supabase, pelo registry de fontes.
//
// ESCOPO: o cron sincroniza só a gestão vigente (gestões encerradas não mudam, e
// reprocessá-las multiplica o risco de estourar a cota do Sheets); o backfill
// varre todas as do registry. Ver `gestoesDoCron` em fontes/registry.ts.
//
// Este módulo ALIMENTA o banco. As telas leem só do banco
// (src/lib/supabase-vendas.ts), nunca da planilha.

import { createClient } from "@supabase/supabase-js";

import {
	lerContratos,
	lerEntregas,
	lerFaturamentoDaGestao,
	lerMetasDaGestao,
} from "@/lib/fontes/sheets-fonte";
import {
	acharOrfaos,
	chaveMeta,
	chaveProjeto,
	mapearContratos,
	mapearMetas,
	normalizarNomeVendedor,
	type ContratoRejeitado,
} from "@/lib/fontes/mapear";
import { FONTE_ENTREGAS, GESTOES, gestoesDoCron, idGestaoVigente } from "@/lib/fontes/registry";
import {
	abrirExecucao,
	type DisparadoPor,
	type Execucao,
} from "@/lib/ingestao/registro";
import type { Gestao } from "@/lib/fontes/tipos";

function getSupabase() {
	return createClient(
		process.env.SUPABASE_URL!,
		process.env.SUPABASE_SERVICE_ROLE_KEY!,
	);
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
			`[SyncSheets] Erro ao upsert vendedor "${nomeNormalizado}":`,
			error?.message,
		);
		return null;
	}

	cacheVendedores[nomeNormalizado] = data.id_vendedor;
	return data.id_vendedor;
}

// ─── Gravação em lote ─────────────────────────────────────────────
//
// A sincronização da planilha levava 45s, e 41 deles eram ida-e-volta ao banco:
// LER a planilha inteira custa 3,6s; gravar 77 contratos e 33 metas, linha por
// linha, custava o resto. Eram ~264 requisições sequenciais para escrever 110
// linhas.
//
// Isso não era só lentidão. Era a diferença entre "corrijo a planilha e vejo o
// resultado" e "corrijo a planilha e espero o cron de amanhã" — porque 45s é
// tempo demais para prender um clique, e por isso a planilha ficava fora do
// botão de atualizar.
//
// Em lote são ~6 requisições. Mas lote troca granularidade por velocidade: uma
// linha ruim derruba as 110. Por isso todo lote aqui tem QUEDA PARA LINHA A
// LINHA — o caminho rápido resolve o dia a dia, e o caminho lento continua
// sabendo dizer QUAL linha está errada, que é o que a auditoria precisa.

/** Resolve todos os nomes de uma vez: 2 idas ao banco em vez de uma por nome. */
async function resolverVendedores(
	supabase: ReturnType<typeof getSupabase>,
	nomesCrus: string[],
): Promise<Map<string, number>> {
	const nomes = [
		...new Set(nomesCrus.map(normalizarNomeVendedor).filter(Boolean)),
	] as string[];
	const mapa = new Map<string, number>();
	if (nomes.length === 0) return mapa;

	const { data: existentes, error } = await supabase
		.from("vendedor")
		.select("id_vendedor, nome_vendedor")
		.in("nome_vendedor", nomes);

	if (error) {
		// Sem o lote, cai no caminho antigo: caro, porém correto.
		for (const nome of nomes) {
			const id = await upsertVendedor(nome);
			if (id) mapa.set(nome, id);
		}
		return mapa;
	}

	for (const v of existentes ?? []) mapa.set(v.nome_vendedor, v.id_vendedor);

	const faltando = nomes.filter((n) => !mapa.has(n));
	if (faltando.length > 0) {
		const { data: criados } = await supabase
			.from("vendedor")
			.upsert(
				faltando.map((nome_vendedor) => ({ nome_vendedor })),
				{ onConflict: "nome_vendedor" },
			)
			.select("id_vendedor, nome_vendedor");
		for (const v of criados ?? []) mapa.set(v.nome_vendedor, v.id_vendedor);
	}

	for (const [nome, id] of mapa) cacheVendedores[nome] = id;
	return mapa;
}

// ─── Resultado ────────────────────────────────────────────────────

export interface ResultadoGestao {
	gestao: string;
	/** id em `ingestao_execucao`. null quando simulando ou sem a migration 0003. */
	execucao: number | null;
	contratos: { inseridos: number; erros: number; removidos: number };
	metas: { inseridos: number; erros: number; derivadas: number; removidos: number };
	/** Faturamento mês a mês + metas de faturamento. null = gestão sem a fonte. */
	faturamento: ResultadoFaturamento | null;
	/**
	 * Linhas que a planilha não pôde fornecer como dado: descartes de leitura
	 * (falta obrigatório) + rejeições de mapeamento (mês ou coordenação
	 * inválidos) + metas ilegíveis. A F5 as grava em `ingestao_rejeicao`; aqui
	 * elas ao menos aparecem na resposta do cron e no log.
	 */
	rejeicoes: { origemRef: string; motivo: string }[];
	/** Algo saiu do esperado — alguém precisa olhar. */
	avisos: string[];
	/** Rotina: o que foi feito e por quê. Não pede ação. */
	notas: string[];
}

export interface ResultadoSync {
	porGestao: ResultadoGestao[];
	/** Planilha de projetos (tela de entregas da TV). Não é por gestão. */
	entregas: ResultadoEntregas;
	totais: {
		contratos: number;
		metas: number;
		erros: number;
		rejeicoes: number;
		removidos: number;
	};
}

/**
 * Acrescenta as colunas de linhagem, se elas existirem.
 *
 * `execucao.id` nulo significa que `ingestao_execucao` não está lá — ou seja,
 * a migration 0003 não foi aplicada, e as colunas `origem_*` também não existem.
 * Mandá-las nesse caso faria TODA gravação falhar. A ingestão continua sem
 * rastro, que é ruim, mas melhor do que parar de funcionar.
 */
function comLinhagem<T extends object>(
	linha: T,
	execucao: Execucao,
	origemTipo: string,
	origemRef: string,
): T {
	if (execucao.id === null) return linha;
	return {
		...linha,
		origem_tipo: origemTipo,
		origem_ref: origemRef,
		id_execucao: execucao.id,
	};
}

// ─── Sincronização de uma gestão ──────────────────────────────────

async function sincronizarGestao(
	gestao: Gestao,
	simular: boolean,
	disparadoPor: DisparadoPor,
): Promise<ResultadoGestao> {
	const supabase = getSupabase();
	const rejeicoes: { origemRef: string; motivo: string }[] = [];
	const avisos: string[] = [];
	const notas: string[] = [];

	// Abre o rastro ANTES de ler: se a leitura estourar, a execução fica
	// registrada como 'falhou' em vez de não existir.
	const execucao: Execucao = await abrirExecucao({
		fonteTipo: "sheets",
		fonteRef: gestao.contratos.spreadsheetId,
		gestao: gestao.id,
		disparadoPor,
		simular,
	});

	try {
		return await executarGestao(gestao, simular, execucao, {
			supabase,
			rejeicoes,
			avisos,
			notas,
		});
	} catch (erro) {
		await execucao.falhar(erro);
		throw erro;
	}
}

async function executarGestao(
	gestao: Gestao,
	simular: boolean,
	execucao: Execucao,
	ctx: {
		supabase: ReturnType<typeof getSupabase>;
		rejeicoes: { origemRef: string; motivo: string }[];
		avisos: string[];
		notas: string[];
	},
): Promise<ResultadoGestao> {
	const { supabase, rejeicoes, avisos, notas } = ctx;

	// ── Contratos ──
	const tabela = await lerContratos(gestao);

	for (const d of tabela.descartadas) {
		rejeicoes.push({ origemRef: d.origemRef, motivo: d.motivo });
		execucao.rejeitar({
			origemRef: d.origemRef,
			motivo: d.motivo,
			campo: d.camposFaltando[0],
			payload: d.valores,
		});
	}
	if (tabela.ignoradas > 0) {
		notas.push(
			`${tabela.ignoradas} linha(s) de ruído estrutural ignorada(s) em "${tabela.aba}"`,
		);
	}

	const { projetos, rejeitados } = mapearContratos(gestao, tabela.linhas);
	for (const r of rejeitados as ContratoRejeitado[]) {
		rejeicoes.push({ origemRef: r.origemRef, motivo: r.motivo });
		execucao.rejeitar({
			origemRef: r.origemRef,
			motivo: r.motivo,
			payload: r.valores,
		});
	}
	// O contrato entra; só o campo opcional se perde. Ainda assim fica registrado.
	for (const p of projetos) {
		for (const motivo of p.camposPerdidos) {
			rejeicoes.push({ origemRef: p.origemRef, motivo });
			execucao.rejeitar({ origemRef: p.origemRef, motivo, payload: p.linha });
		}
	}

	let contratosInseridos = 0;
	let contratosErros = 0;

	// Contrato repetido na aba — mesmo nome, coordenação E mês. O upsert em lote
	// não aceita tocar a mesma linha duas vezes (21000), e o laço antigo aceitava
	// calado: o segundo sobrescrevia o primeiro e ninguém ficava sabendo. Vence o
	// último, e passamos a DIZER que aconteceu. Homônimos de coordenação ou mês
	// diferentes NÃO caem aqui: são contratos distintos (ver `chaveProjeto`).
	const porChave = new Map<string, (typeof projetos)[number]>();
	const repetidos: string[] = [];
	for (const p of projetos) {
		const chave = chaveProjeto(p.linha);
		if (porChave.has(chave)) {
			repetidos.push(`${p.linha.nome_projeto} (${p.linha.coordenacao}, ${p.origemRef})`);
		}
		porChave.set(chave, p);
	}
	if (repetidos.length > 0) {
		avisos.push(
			`${repetidos.length} contrato(s) repetido(s) na aba (mesmo nome, coordenação e mês) — só a última linha de cada vale: ${repetidos.join("; ")}`,
		);
	}
	const unicos = [...porChave.values()];

	const idPorNome = new Map<string, number>();

	if (simular) {
		contratosInseridos = unicos.length;
	} else {
		const { data: gravados, error: erroLote } = await supabase
			.from("projeto_vendido")
			.upsert(
				unicos.map((p) =>
					comLinhagem(p.linha, execucao, "sheets", p.origemRef),
				),
				{ onConflict: "nome_projeto,gestao,coordenacao,mes_venda" },
			)
			.select("id_projeto, nome_projeto, coordenacao, mes_venda");

		if (!erroLote && gravados) {
			for (const g of gravados) idPorNome.set(chaveProjeto(g), g.id_projeto);
			contratosInseridos = gravados.length;
		} else {
			// QUEDA PARA LINHA A LINHA. O lote falha inteiro por causa de uma
			// linha; sem este caminho, um contrato malformado apagaria a gestão
			// inteira da tela e o log diria apenas "erro".
			console.warn(
				`[SyncSheets] ${gestao.id} — lote de contratos falhou (${erroLote?.message}). Gravando linha a linha para achar a culpada.`,
			);
			for (const p of unicos) {
				const { data: projeto, error } = await supabase
					.from("projeto_vendido")
					.upsert(comLinhagem(p.linha, execucao, "sheets", p.origemRef), {
						onConflict: "nome_projeto,gestao,coordenacao,mes_venda",
					})
					.select("id_projeto")
					.single();

				if (error || !projeto) {
					console.error(
						`[SyncSheets] ${gestao.id} — erro ao gravar "${p.linha.nome_projeto}" (${p.origemRef}):`,
						error?.message,
					);
					contratosErros++;
					continue;
				}
				idPorNome.set(chaveProjeto(p.linha), projeto.id_projeto);
				contratosInseridos++;
			}
		}

		// ── Vínculos de responsáveis ──
		//
		// SUBSTITUI, não acrescenta. Só acrescentar parece inofensivo até um nome
		// mudar na planilha: o nome novo vira outro vendedor, o vínculo antigo
		// continua, e o projeto passa a listar os dois. Aconteceu de verdade ao
		// corrigir o bug de acentuação — 93 projetos ficaram com "LuíS | Luís", e
		// em alguns o nome certo foi empurrado para fora das quatro posições que a
		// tela mostra.
		const ids = [...idPorNome.values()];
		if (ids.length > 0) {
			const vendedores = await resolverVendedores(
				supabase,
				unicos.flatMap((p) => p.responsaveis),
			);

			const vinculos: { id_projeto: number; id_vendedor: number }[] = [];
			for (const p of unicos) {
				const idProjeto = idPorNome.get(chaveProjeto(p.linha));
				if (!idProjeto) continue;
				const vistos = new Set<number>();
				for (const nome of p.responsaveis) {
					const idVendedor = vendedores.get(normalizarNomeVendedor(nome));
					// Um mesmo nome repetido na linha não pode virar dois vínculos.
					if (!idVendedor || vistos.has(idVendedor)) continue;
					vistos.add(idVendedor);
					vinculos.push({ id_projeto: idProjeto, id_vendedor: idVendedor });
				}
			}

			const { error: erroDelete } = await supabase
				.from("projeto_vendedor")
				.delete()
				.in("id_projeto", ids);

			// Apagar e não reinserir deixaria projetos sem responsável. Se a limpeza
			// falhou, não insere — duplicar é ruim, mas silenciosamente zerar os
			// responsáveis de 77 projetos é pior.
			if (erroDelete) {
				console.error(
					`[SyncSheets] ${gestao.id} — erro ao limpar vínculos:`,
					erroDelete.message,
				);
				avisos.push(
					"Não foi possível regravar os responsáveis dos projetos nesta rodada.",
				);
			} else if (vinculos.length > 0) {
				const { error: erroVinculo } = await supabase
					.from("projeto_vendedor")
					.insert(vinculos);
				if (erroVinculo) {
					console.error(
						`[SyncSheets] ${gestao.id} — erro ao vincular responsáveis:`,
						erroVinculo.message,
					);
					avisos.push("Responsáveis não foram regravados nesta rodada.");
				}
			}
		}
	}

	// ── Metas ──
	const lidas = await lerMetasDaGestao(gestao);
	avisos.push(...lidas.avisos);
	notas.push(...lidas.notas);
	for (const i of lidas.ilegiveis) {
		const motivo = `meta ${i.rotulo}: ${i.motivo} ("${i.bruto}")`;
		rejeicoes.push({ origemRef: i.origemRef, motivo });
		execucao.rejeitar({
			origemRef: i.origemRef,
			motivo,
			payload: { rotulo: i.rotulo, bruto: i.bruto },
		});
	}

	const metas = mapearMetas(gestao, lidas.metas);

	let metasInseridas = 0;
	let metasErros = 0;

	// O índice único é (gestao_meta, tipo_meta, periodo, coordenacao) com NULLS
	// NOT DISTINCT — precisa das QUATRO colunas. Declarar menos levanta 42P10 em
	// toda linha, que foi o bug corrigido na F0.
	// Meta derivada guarda o cálculo em origem_ref: número calculado apresentado
	// como lido é o que a auditoria existe para pegar.
	const linhasDeMeta = metas.map((m) =>
		comLinhagem(m.linha, execucao, m.derivada ? "derivado" : "sheets", m.origemRef),
	);

	if (simular) {
		metasInseridas = metas.length;
	} else if (linhasDeMeta.length > 0) {
		const { error: erroLote } = await supabase
			.from("meta")
			.upsert(linhasDeMeta, {
				onConflict: "gestao_meta,tipo_meta,periodo,coordenacao",
			});

		if (!erroLote) {
			metasInseridas = linhasDeMeta.length;
		} else {
			// Mesma queda dos contratos: o lote não sabe qual meta está errada, o
			// laço sabe.
			console.warn(
				`[SyncSheets] ${gestao.id} — lote de metas falhou (${erroLote.message}). Gravando uma a uma.`,
			);
			for (const m of metas) {
				const { error } = await supabase
					.from("meta")
					.upsert(
						comLinhagem(
							m.linha,
							execucao,
							m.derivada ? "derivado" : "sheets",
							m.origemRef,
						),
						{ onConflict: "gestao_meta,tipo_meta,periodo,coordenacao" },
					);
				if (error) {
					console.error(
						`[SyncSheets] ${gestao.id} — erro ao gravar meta ${m.linha.tipo_meta}/${m.linha.periodo}/${m.linha.coordenacao ?? "GERAL"}:`,
						error.message,
					);
					metasErros++;
					continue;
				}
				metasInseridas++;
			}
		}
	}

	// ── Faturamento ──
	const faturamento = await sincronizarFaturamento(gestao, simular, execucao, ctx);

	// ── Reconciliação ──
	// Sem isto o banco só ganha linhas: renomear um projeto na planilha insere a
	// nova e deixa a antiga, e apagar uma linha não apaga nada. Os dois casos
	// viram número inflado assim que a F3 fizer o dashboard ler o banco.
	const removidos = await reconciliar(
		gestao,
		new Set(projetos.map((p) => chaveProjeto(p.linha))),
		new Set(
			metas.map((m) =>
				chaveMeta(m.linha.tipo_meta, m.linha.periodo, m.linha.coordenacao),
			),
		),
		{ simular, houveLeitura: projetos.length > 0, avisos, notas },
	);

	// Os contadores cobrem o MESMO universo: contratos e metas juntos. A primeira
	// versão contava só contratos em `lidas` e contratos + metas em `aceitas`,
	// produzindo "lidas=100, aceitas=135" — aceitas maior que lidas. Número
	// incoerente numa tabela de auditoria destrói a confiança nela inteira.
	//
	// Invariante: lidas = aceitas + rejeitadas + ignoradas.
	const contratosLidos =
		tabela.linhas.length + tabela.descartadas.length + tabela.ignoradas;
	const metasLidas = lidas.metas.length + lidas.ilegiveis.length;

	await execucao.finalizar({
		lidas: contratosLidos + metasLidas + (faturamento?.lidas ?? 0),
		aceitas: contratosInseridos + metasInseridas + (faturamento?.aceitas ?? 0),
		ignoradas: tabela.ignoradas,
		removidas: removidos.projetos + removidos.metas + (faturamento?.removidos ?? 0),
		erros: contratosErros + metasErros + (faturamento?.erros ?? 0),
	});

	return {
		gestao: gestao.id,
		execucao: execucao.id,
		contratos: {
			inseridos: contratosInseridos,
			erros: contratosErros,
			removidos: removidos.projetos,
		},
		metas: {
			inseridos: metasInseridas,
			erros: metasErros,
			derivadas: metas.filter((m) => m.derivada).length,
			removidos: removidos.metas,
		},
		faturamento,
		rejeicoes,
		avisos,
		notas,
	};
}

export interface ResultadoFaturamento {
	lidas: number;
	aceitas: number;
	erros: number;
	removidos: number;
}

/**
 * Faturamento mês a mês e metas de faturamento (migration 0014).
 *
 * Falha aqui NÃO derruba a gestão: contratos e metas de vendas já foram
 * gravados, e são eles que as telas do dashboard usam. Planilha de faturamento
 * sem compartilhamento com a conta de serviço vira aviso, não 500 no cron.
 */
async function sincronizarFaturamento(
	gestao: Gestao,
	simular: boolean,
	execucao: Execucao,
	ctx: {
		supabase: ReturnType<typeof getSupabase>;
		rejeicoes: { origemRef: string; motivo: string }[];
		avisos: string[];
		notas: string[];
	},
): Promise<ResultadoFaturamento | null> {
	if (!gestao.faturamento) return null;
	const { supabase, rejeicoes, avisos, notas } = ctx;

	let lido: Awaited<ReturnType<typeof lerFaturamentoDaGestao>>;
	try {
		lido = await lerFaturamentoDaGestao(gestao);
	} catch (erro) {
		avisos.push(
			`faturamento não lido (${erro instanceof Error ? erro.message : String(erro)}). ` +
				`A planilha está compartilhada com a conta de serviço?`,
		);
		return { lidas: 0, aceitas: 0, erros: 1, removidos: 0 };
	}
	if (!lido) return null;

	avisos.push(...lido.avisos, ...lido.metas.avisos);
	notas.push(...lido.metas.notas);
	for (const i of [...lido.ilegiveis, ...lido.metas.ilegiveis]) {
		const motivo = `faturamento ${i.rotulo}: ${i.motivo} ("${i.bruto}")`;
		rejeicoes.push({ origemRef: i.origemRef, motivo });
		execucao.rejeitar({ origemRef: i.origemRef, motivo, payload: { rotulo: i.rotulo, bruto: i.bruto } });
	}

	// O "total" do bloco mensal soma só os meses que já têm meta (out/26 = R$ 125
	// mil, o resto "?????"). Gravado como meta de gestão, diria que a meta do ano
	// é a de outubro.
	const metasLidas = lido.metas.metas.filter((m) => m.tipo !== "gestao");
	if (metasLidas.length < lido.metas.metas.length) {
		notas.push("faturamento: meta de gestão não gravada — o 'total' da planilha soma só os meses definidos.");
	}
	const metas = mapearMetas(gestao, metasLidas).map((m) =>
		comLinhagem(m.linha, execucao, "sheets", m.origemRef),
	);
	const meses = lido.meses.map((m) =>
		comLinhagem(
			{ gestao: gestao.id, coordenacao: m.coordenacao, mes: m.mes, previsto: m.previsto, realizado: m.realizado },
			execucao,
			"sheets",
			m.origemRef,
		),
	);

	const resultado: ResultadoFaturamento = {
		lidas: meses.length + lido.metas.metas.length + lido.metas.ilegiveis.length,
		aceitas: meses.length + metas.length,
		erros: 0,
		removidos: 0,
	};
	if (simular) return resultado;

	const gravar = async (tabela: string, linhas: object[], onConflict: string) => {
		if (linhas.length === 0) return true;
		const { error } = await supabase.from(tabela).upsert(linhas, { onConflict });
		if (error) {
			avisos.push(`faturamento: gravação em ${tabela} falhou (${error.message}).`);
			resultado.erros++;
			resultado.aceitas -= linhas.length;
		}
		return !error;
	};
	await gravar("faturamento_mes", meses, "gestao,coordenacao,mes");
	const metasOk = await gravar("meta_faturamento", metas, "gestao_meta,tipo_meta,periodo,coordenacao");

	// Meta que voltou a "?????" sai do banco. A grade de meses é fixa (12 × 6)
	// e não precisa disso. Só reconcilia se a aba de metas trouxe alguma coisa:
	// aba vazia é leitura quebrada, não "todas as metas foram apagadas".
	if (metasOk && lido.metas.metas.length + lido.metas.ilegiveis.length > 0) {
		const { data } = await supabase
			.from("meta_faturamento")
			.select("id_meta, tipo_meta, periodo, coordenacao")
			.eq("gestao_meta", gestao.id);
		const vigentes = new Set(
			metas.map((m) => chaveMeta(m.tipo_meta, m.periodo, m.coordenacao)),
		);
		const orfas = (data ?? []).filter(
			(r: { tipo_meta: string; periodo: string; coordenacao: string | null }) =>
				!vigentes.has(chaveMeta(r.tipo_meta, r.periodo, r.coordenacao)),
		);
		if (orfas.length > 0) {
			await supabase
				.from("meta_faturamento")
				.delete()
				.in("id_meta", orfas.map((r: { id_meta: number }) => r.id_meta));
			resultado.removidos = orfas.length;
			notas.push(`faturamento: ${orfas.length} meta(s) que sumiram da planilha removida(s).`);
		}
	}

	return resultado;
}

/**
 * Apaga do banco o que sumiu da planilha, dentro da gestão sincronizada.
 *
 * Duas travas, porque isto APAGA dado:
 *   1. Só mexe na gestão que acabou de ser lida — o cron lê só a vigente e não
 *      pode encostar nas encerradas.
 *   2. Se a leitura não trouxe contrato nenhum, não apaga nada. Leitura vazia é
 *      quase sempre falha de acesso ou aba renomeada; apagar nesse caso limparia
 *      a gestão inteira por causa de um erro transitório.
 */
async function reconciliar(
	gestao: Gestao,
	chavesProjetos: Set<string>,
	chavesMetas: Set<string>,
	ctx: {
		simular: boolean;
		houveLeitura: boolean;
		avisos: string[];
		notas: string[];
	},
): Promise<{ projetos: number; metas: number }> {
	if (!ctx.houveLeitura) {
		ctx.avisos.push(
			`reconciliação PULADA: a leitura de "${gestao.contratos.aba}" não trouxe ` +
				`nenhum contrato. Não apagamos nada — leitura vazia costuma ser falha ` +
				`de acesso, não planilha vazia.`,
		);
		return { projetos: 0, metas: 0 };
	}

	const supabase = getSupabase();

	// ── Projetos ──
	const { data: projetosBanco, error: erroProjetos } = await supabase
		.from("projeto_vendido")
		.select("id_projeto, nome_projeto, coordenacao, mes_venda")
		.eq("gestao", gestao.id);

	if (erroProjetos) {
		ctx.avisos.push(
			`reconciliação de contratos falhou: ${erroProjetos.message}`,
		);
		return { projetos: 0, metas: 0 };
	}

	const orfaosProjeto = acharOrfaos(
		projetosBanco ?? [],
		chaveProjeto,
		chavesProjetos,
	);

	// ── Metas ──
	const { data: metasBanco, error: erroMetas } = await supabase
		.from("meta")
		.select("id_meta, tipo_meta, periodo, coordenacao")
		.eq("gestao_meta", gestao.id);

	if (erroMetas) {
		ctx.avisos.push(`reconciliação de metas falhou: ${erroMetas.message}`);
	}

	const orfaosMeta = acharOrfaos(
		metasBanco ?? [],
		(m: { tipo_meta: string; periodo: string; coordenacao: string | null }) =>
			chaveMeta(m.tipo_meta, m.periodo, m.coordenacao),
		chavesMetas,
	);

	if (orfaosProjeto.length === 0 && orfaosMeta.length === 0) {
		return { projetos: 0, metas: 0 };
	}

	// Remoção é destino, não rotina: sempre aparece como aviso, com os nomes.
    const detalhe = [
		orfaosProjeto.length > 0
			? `${orfaosProjeto.length} contrato(s): ${orfaosProjeto
					.slice(0, 5)
					.map((p: { nome_projeto: string }) => `"${p.nome_projeto}"`)
					.join(", ")}${orfaosProjeto.length > 5 ? "…" : ""}`
			: null,
		orfaosMeta.length > 0 ? `${orfaosMeta.length} meta(s)` : null,
	]
		.filter(Boolean)
		.join(" e ");

	ctx.avisos.push(
		`${ctx.simular ? "[simulação] " : ""}sumiu da planilha e ` +
			`${ctx.simular ? "seria removido" : "foi removido"} do banco — ${detalhe}. ` +
			`Costuma ser projeto renomeado ou linha apagada.`,
	);

	if (ctx.simular) {
		return { projetos: orfaosProjeto.length, metas: orfaosMeta.length };
	}

	if (orfaosProjeto.length > 0) {
		const ids = orfaosProjeto.map((p: { id_projeto: number }) => p.id_projeto);
		// projeto_vendedor primeiro: tem FK para projeto_vendido.
		await supabase.from("projeto_vendedor").delete().in("id_projeto", ids);
		await supabase.from("projeto_vendido").delete().in("id_projeto", ids);
	}

	if (orfaosMeta.length > 0) {
		await supabase
			.from("meta")
			.delete()
			.in(
				"id_meta",
				orfaosMeta.map((m: { id_meta: number }) => m.id_meta),
			);
	}

	return { projetos: orfaosProjeto.length, metas: orfaosMeta.length };
}

// ─── Função principal ─────────────────────────────────────────────

export interface OpcoesSyncSheets {
	/**
	 * Gestões a sincronizar. Sem isto, usa o escopo do cron (só a vigente).
	 * O backfill passa `GESTOES` inteiro.
	 */
	gestoes?: Gestao[];
	/** Data de referência para resolver a gestão vigente. Existe para testes. */
	hoje?: Date;
	/** Quem disparou — vai para o registro de execução. */
	disparadoPor?: DisparadoPor;
	/**
	 * Lê e mapeia tudo, mas NÃO escreve no banco. Serve para conferir o que
	 * entraria antes de uma recarga destrutiva.
	 */
	simular?: boolean;
}

export async function sincronizarSheets(
	opcoes: OpcoesSyncSheets = {},
): Promise<ResultadoSync> {
	// Sem escopo explícito, `gestoesDoCron` resolve pela data. Se a vigente ainda
	// não tem planilha (virada de gestão), devolve a mais recente cadastrada — e
	// o aviso abaixo garante que isso não passe despercebido.
	const gestoes = opcoes.gestoes ?? gestoesDoCron(opcoes.hoje);
	const vigente = idGestaoVigente(opcoes.hoje);
	const semFonteDaVigente =
		!opcoes.gestoes && !gestoes.some((g) => g.id === vigente);

	const porGestao: ResultadoGestao[] = [];

	// Sequencial de propósito: a cota de leitura do Sheets é por minuto e por
	// usuário, e estourá-la já derrubou o dashboard em produção.
	for (const g of gestoes) {
		console.log(
			`[SyncSheets] ${opcoes.simular ? "SIMULANDO" : "Sincronizando"} gestão ${g.id}...`,
		);
		const resultado = await sincronizarGestao(
			g,
			opcoes.simular === true,
			opcoes.disparadoPor ?? "manual",
		);
		if (semFonteDaVigente) {
			resultado.avisos.push(
				`A gestão vigente é ${vigente}, mas não há fonte cadastrada para ela. ` +
					`Sincronizando ${g.id}, a mais recente cadastrada. Quando existir a ` +
					`planilha ${vigente}, cadastre-a em src/lib/fontes/registry.ts.`,
			);
		}
		porGestao.push(resultado);
	}

	const entregas = await sincronizarEntregas(
		opcoes.simular === true,
		opcoes.disparadoPor ?? "manual",
	);

	// Vendedor sem nenhum vínculo é resíduo: sobra quando um nome é corrigido na
	// planilha ou um projeto sai. Não corrompe número — nada lê a tabela sozinha —
	// mas acumula a cada recarga e polui qualquer listagem futura de pessoas.
	if (!opcoes.simular) {
		const removidos = await removerVendedoresOrfaos();
		if (removidos > 0) {
			console.log(`[SyncSheets] ${removidos} vendedor(es) sem vínculo removido(s).`);
		}
	}

	const totais = porGestao.reduce(
		(acc, r) => ({
			contratos: acc.contratos + r.contratos.inseridos,
			metas: acc.metas + r.metas.inseridos,
			erros: acc.erros + r.contratos.erros + r.metas.erros,
			rejeicoes: acc.rejeicoes + r.rejeicoes.length,
			removidos: acc.removidos + r.contratos.removidos + r.metas.removidos,
		}),
		{ contratos: 0, metas: 0, erros: 0, rejeicoes: 0, removidos: 0 },
	);

	return { porGestao, entregas, totais };
}

// ─── Entregas ─────────────────────────────────────────────────────

export interface ResultadoEntregas {
	execucao: number | null;
	inseridos: number;
	removidos: number;
	erros: number;
	rejeicoes: { origemRef: string; motivo: string }[];
	avisos: string[];
}

/**
 * Projetos entregues e em execução (migration 0015), da planilha de projetos.
 *
 * Roda uma vez por sync, fora do laço de gestões: a aba cobre todas. Falha aqui
 * vira aviso e não derruba o sync — contratos e metas já foram gravados.
 */
async function sincronizarEntregas(
	simular: boolean,
	disparadoPor: DisparadoPor,
): Promise<ResultadoEntregas> {
	const supabase = getSupabase();
	const fonte = FONTE_ENTREGAS;
	const r: ResultadoEntregas = { execucao: null, inseridos: 0, removidos: 0, erros: 0, rejeicoes: [], avisos: [] };
	const execucao = await abrirExecucao({
		fonteTipo: "sheets",
		fonteRef: fonte.spreadsheetId,
		disparadoPor,
		simular,
	});
	r.execucao = execucao.id;

	try {
		const lidos = await lerEntregas(fonte);
		const projetos = lidos.flatMap((l) => l.projetos);
		for (const l of lidos) {
			r.avisos.push(...l.avisos);
			for (const x of l.rejeitadas) {
				r.rejeicoes.push({ origemRef: x.origemRef, motivo: x.motivo });
				execucao.rejeitar({ origemRef: x.origemRef, motivo: x.motivo, payload: x.linha });
			}
		}
		const linhas = projetos.map((p) =>
			comLinhagem(
				{
					estado: p.estado,
					coordenacao: p.coordenacao,
					nome_projeto: p.projeto,
					gestao_venda: p.gestaoVenda,
					gestao_entrega: p.gestaoEntrega,
					data_entrega: p.dataEntrega,
					tamanho_equipe: p.tamanhoEquipe,
					equipe: p.equipe,
					situacao: p.situacao,
				},
				execucao,
				"sheets",
				p.origemRef,
			),
		);
		const chave = (x: { estado: string; coordenacao: string; nome_projeto: string; gestao_venda: string | null }) =>
			`${x.estado}|${x.coordenacao}|${x.nome_projeto}|${x.gestao_venda}`;

		if (!simular && linhas.length > 0) {
			const { error } = await supabase
				.from("projeto_entrega")
				.upsert(linhas, { onConflict: "estado,coordenacao,nome_projeto,gestao_venda" });
			if (error) {
				r.avisos.push(`entregas: gravação falhou (${error.message}).`);
				r.erros++;
			} else {
				r.inseridos = linhas.length;
			}
		}

		// Some da planilha → sai do banco (o projeto que passou de "Atual" para
		// "Entregues", por exemplo). Só com as DUAS abas lidas: aba vazia é
		// leitura quebrada, não "todos os projetos acabaram".
		if (!simular && r.erros === 0 && lidos.every((l) => l.projetos.length > 0)) {
			type Linha = { id_projeto_entrega: number; estado: string; coordenacao: string; nome_projeto: string; gestao_venda: string | null };
			const noBanco: Linha[] = [];
			for (let inicio = 0; ; inicio += 1000) {
				const { data, error } = await supabase
					.from("projeto_entrega")
					.select("id_projeto_entrega, estado, coordenacao, nome_projeto, gestao_venda")
					.order("id_projeto_entrega", { ascending: true })
					.range(inicio, inicio + 999);
				if (error) throw new Error(`projeto_entrega: ${error.message}`);
				noBanco.push(...((data ?? []) as Linha[]));
				if ((data ?? []).length < 1000) break;
			}
			const orfaos = acharOrfaos(noBanco, chave, new Set(linhas.map(chave)));
			if (orfaos.length > 0) {
				await supabase
					.from("projeto_entrega")
					.delete()
					.in("id_projeto_entrega", orfaos.map((o) => o.id_projeto_entrega));
				r.removidos = orfaos.length;
			}
		}

		await execucao.finalizar({
			lidas: projetos.length + r.rejeicoes.length + lidos.reduce((s, l) => s + l.ignoradas, 0),
			aceitas: r.inseridos,
			ignoradas: lidos.reduce((s, l) => s + l.ignoradas, 0),
			removidas: r.removidos,
			erros: r.erros,
		});
	} catch (erro) {
		await execucao.falhar(erro);
		r.erros++;
		r.avisos.push(
			`entregas não lidas (${erro instanceof Error ? erro.message : String(erro)}). ` +
				`A planilha de projetos está compartilhada com a conta de serviço?`,
		);
	}
	return r;
}

/**
 * Remove vendedores que não estão ligados a nenhum projeto nem a nenhum card.
 *
 * Seguro por construção: um vendedor sem vínculo não é referenciado por nada e
 * não participa de cálculo nenhum. É varrer resíduo, não apagar dado.
 */
async function removerVendedoresOrfaos(): Promise<number> {
	const supabase = getSupabase();

	// PAGINAR é obrigatório aqui. O Supabase corta a resposta em 1000 linhas, e
	// `card_vendedor` passa disso (1200+ cards com responsáveis). Sem paginar, os
	// vínculos além da primeira página somem da conta e vendedores em uso são
	// classificados como órfãos. Aconteceu: o delete só não destruiu dado porque
	// a foreign key barrou.
	async function idsVendedor(tabela: string): Promise<number[]> {
		const ids: number[] = [];
		let inicio = 0;
		for (;;) {
			const { data, error } = await supabase
				.from(tabela)
				.select("id_vendedor")
				.order("id_vendedor", { ascending: true })
				.range(inicio, inicio + 999);
			if (error) throw new Error(`${tabela}: ${error.message}`);
			const lote = data ?? [];
			ids.push(...lote.map((v) => v.id_vendedor as number));
			if (lote.length < 1000) break;
			inicio += 1000;
		}
		return ids;
	}

	// A lista de vendedores TAMBÉM pagina. O comentário acima já dizia por quê e
	// esta linha lia a tabela inteira sem `.range()` mesmo assim — hoje são 280
	// linhas, mas cada apelido novo de 23/24 cria mais uma, e o dia em que
	// passasse de mil os excedentes deixariam de ser examinados em silêncio.
	const [todos, deProjeto, deCard] = await Promise.all([
		idsVendedor("vendedor"),
		idsVendedor("projeto_vendedor"),
		idsVendedor("card_vendedor"),
	]);

	const comVinculo = new Set([...deProjeto, ...deCard]);

	const orfaos = todos.filter((id) => !comVinculo.has(id));

	if (orfaos.length === 0) return 0;

	const { error } = await supabase
		.from("vendedor")
		.delete()
		.in("id_vendedor", orfaos);

	if (error) {
		console.error(
			"[SyncSheets] Erro ao remover vendedores órfãos:",
			error.message,
		);
		return 0;
	}

	return orfaos.length;
}

/** Todas as gestões do registry — usado pelo backfill. */
export function todasAsGestoes(): Gestao[] {
	return GESTOES;
}
