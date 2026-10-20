// scripts/auditar-banco.ts
//
// Confere invariantes do banco contra o registry e as planilhas. Somente leitura.
//
// Nasceu de um caso real: o dashboard mostrava 100 projetos em 24/25 onde o
// pipeline aceita 99. A linha extra veio do cron de PRODUÇÃO, que ainda roda o
// código antigo lendo a planilha filtrada. Nada acusou — a diferença só apareceu
// porque alguém reparou num número.
//
// TRÊS ESTADOS, não dois. Query que falha NÃO é invariante satisfeito.
// A primeira versão deste script checava `(data ?? []).length === 0` e reportava
// ✓ quando a query dava erro — "column origem_ref does not exist" virava
// "nenhuma linha sem origem". Verificador que não sabe falhar é pior que
// verificador nenhum, porque dá confiança falsa.
//
// Uso:
//   npx tsx scripts/auditar-banco.ts
//
// Sai com 1 se algum invariante falhar OU se algo não pôde ser verificado.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient, type PostgrestError } from "@supabase/supabase-js";

import { GESTOES, idsDeGestao } from "../src/lib/fontes/registry";
import { MESES_DA_GESTAO } from "../src/lib/fontes/calendario";
import { lerContratos } from "../src/lib/fontes/sheets-fonte";
import { mapearContratos, chaveProjeto } from "../src/lib/fontes/mapear";
import { todosOsPipes } from "../src/lib/fontes/pipes";
import { COBERTURAS } from "../src/lib/fontes/cobertura";
import { buscarVendasDoBanco, buscarMetasDoBanco } from "../src/lib/supabase-vendas";
import {
	VERSAO_CALCULO,
	hashMetricas,
	type MetricasCongeladas,
} from "../src/lib/snapshots/metricas";
import { compararComAFonte, type Snapshot } from "../src/lib/snapshots/ler";
import { periodosCongelaveis } from "../src/lib/snapshots/congelar";
import {
	medirFrescor,
	horasDesdeOAgendador,
	LIMITE_FRESCOR_HORAS,
	LIMITE_AGENDADOR_HORAS,
} from "../src/lib/auditoria/frescor";

const supabase = createClient(
	process.env.SUPABASE_URL!,
	process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const ok: string[] = [];
const problemas: string[] = [];
const naoVerificados: string[] = [];
/**
 * Fato que vale saber e NÃO exige ação — não entra na conta de problemas nem
 * afeta o código de saída.
 *
 * A separação é a mesma da ingestão, pelo mesmo motivo: ✗ que aparece em toda
 * rodada sem nada a fazer ensina a ignorar a lista, e aí o ✗ que importa passa
 * batido junto.
 */
const notas: string[] = [];

function conferir(condicao: boolean, descricao: string, detalhe?: string) {
	if (condicao) ok.push(descricao);
	else problemas.push(`${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
}

/**
 * Devolve os dados, ou `null` registrando que o invariante ficou SEM VERIFICAR.
 * O caller deve abortar a checagem quando receber null — nunca seguir tratando
 * ausência de dados como ausência de problemas.
 */
function dados<T>(
	res: { data: T[] | null; error: PostgrestError | null },
	descricao: string,
): T[] | null {
	if (res.error) {
		naoVerificados.push(`${descricao} — a consulta falhou: ${res.error.message}`);
		return null;
	}
	return res.data ?? [];
}

/**
 * Lê uma tabela INTEIRA, em páginas de 1000.
 *
 * O Supabase corta em 1000 linhas (`max-rows`) e não avisa: a resposta chega com
 * `error: null` e mil linhas, indistinguível de uma tabela com mil linhas. Já
 * produziu dois bugs neste projeto — uma limpeza de vendedores que tratou 1800
 * vínculos como 1000 e apagou o que não devia, e uma auditoria que só enxergava
 * o primeiro terço de `card`. Toda leitura de tabela grande passa por aqui.
 */
async function todasAsLinhas<T>(
	descricao: string,
	consulta: (de: number, ate: number) => PromiseLike<{
		data: T[] | null;
		error: PostgrestError | null;
	}>,
	/** Tabela para conferir o total contra `count: exact`. */
	tabela?: string,
): Promise<T[] | null> {
	const linhas: T[] = [];
	let inicio = 0;
	for (;;) {
		const lote = dados<T>(await consulta(inicio, inicio + 999), descricao);
		if (lote === null) return null;
		linhas.push(...lote);
		if (lote.length < 1000) break;
		inicio += 1000;
	}

	// CONFERÊNCIA DO PRÓPRIO MECANISMO. Paginar sem ORDER BY estável perde e
	// repete linhas — o Postgres não deve ordem nenhuma entre duas consultas
	// OFFSET/LIMIT separadas. Medido aqui em 11/08/2026: 1236 linhas viravam
	// 1234 únicas mais 2 repetidas. As consultas ordenam, mas quem verifica não
	// pode confiar no que verifica: se o total lido não bate com o total do
	// banco, o problema é do leitor e todo invariante calculado sobre ele fica
	// sem valor.
	if (tabela) {
		const { count, error } = await supabase
			.from(tabela)
			.select("*", { count: "exact", head: true });
		if (error) {
			naoVerificados.push(`total de ${tabela} — ${error.message}`);
		} else if ((count ?? 0) !== linhas.length) {
			problemas.push(
				`leitura paginada de ${tabela} trouxe ${linhas.length} linha(s) e a ` +
					`tabela tem ${count}. Falta `.concat(
						`.order() estável na consulta — sem ele a paginação perde linhas.`,
					),
			);
			return null;
		}
	}

	return linhas;
}

async function idsVinculados(tabela: string): Promise<number[] | null> {
	const linhas = await todasAsLinhas<{ id_vendedor: number }>(
		`vínculos de ${tabela}`,
		(de, ate) =>
			supabase
				.from(tabela)
				.select("id_vendedor")
				.order("id_vendedor", { ascending: true })
				.range(de, ate),
		tabela,
	);
	return linhas?.map((v) => v.id_vendedor) ?? null;
}

async function main() {
	console.log("=== Auditoria do banco ===\n");

	// ── 1. Assinatura do pipeline antigo ──────────────────────────
	const nulos = dados<{ nome_projeto: string; gestao: string }>(
		await supabase
			.from("projeto_vendido")
			.select("nome_projeto, gestao")
			.is("valor_vendido_real", null),
		"linhas com valor_vendido_real nulo",
	);
	if (nulos) {
		conferir(
			nulos.length === 0,
			"nenhuma linha com valor_vendido_real nulo (assinatura do pipeline antigo)",
			nulos.map((n) => `"${n.nome_projeto}" (${n.gestao})`).join(", "),
		);
	}

	// ── 2. Gestões desconhecidas ──────────────────────────────────
	const conhecidas = idsDeGestao();

	const gestoesProjeto = dados<{ gestao: string }>(
		await supabase.from("projeto_vendido").select("gestao"),
		"gestões em projeto_vendido",
	);
	if (gestoesProjeto) {
		const fora = [...new Set(gestoesProjeto.map((r) => r.gestao))].filter(
			(g) => !conhecidas.includes(g),
		);
		conferir(
			fora.length === 0,
			"toda gestão em projeto_vendido está no registry",
			fora.join(", "),
		);
	}

	const gestoesMeta = dados<{ gestao_meta: string }>(
		await supabase.from("meta").select("gestao_meta"),
		"gestões em meta",
	);
	if (gestoesMeta) {
		const fora = [...new Set(gestoesMeta.map((r) => r.gestao_meta))].filter(
			(g) => !conhecidas.includes(g),
		);
		conferir(
			fora.length === 0,
			"toda gestão em meta está no registry",
			fora.join(", "),
		);
	}

	// ── 3. Períodos de meta válidos ───────────────────────────────
	const metas = dados<{
		tipo_meta: string;
		periodo: string;
		gestao_meta: string;
	}>(
		await supabase.from("meta").select("tipo_meta, periodo, gestao_meta"),
		"períodos de meta",
	);
	if (metas) {
		const invalidas = metas.filter((m) => {
			const g = GESTOES.find((x) => x.id === m.gestao_meta);
			if (!g) return true;
			if (m.tipo_meta === "gestao") return m.periodo !== g.id;
			if (m.tipo_meta === "ciclo")
				return !g.ciclos.some((c) => c.id === m.periodo);
			if (m.tipo_meta === "mes")
				return !(MESES_DA_GESTAO as readonly string[]).includes(m.periodo);
			return true;
		});
		conferir(
			invalidas.length === 0,
			"todo período de meta existe no calendário da sua gestão",
			invalidas
				.slice(0, 8)
				.map((m) => `${m.gestao_meta}/${m.tipo_meta}/${m.periodo}`)
				.join(", "),
		);
	}

	// ── 4. Banco × planilha, por gestão ───────────────────────────
	for (const g of GESTOES) {
		const tabela = await lerContratos(g);
		const { projetos } = mapearContratos(g, tabela.linhas);
		// Lista, não conjunto: contar chaves distintas escondia contratos
		// colapsados — banco e planilha "coincidiam" com 81 de 83.
		const chavesDaPlanilha = [
			...new Set(projetos.map((p) => chaveProjeto(p.linha))),
		];
		const naPlanilha = new Set(chavesDaPlanilha);
		if (projetos.length !== chavesDaPlanilha.length) {
			conferir(
				false,
				`${g.id}: contratos repetidos na planilha`,
				`${projetos.length} linhas válidas, ${chavesDaPlanilha.length} identidades distintas (mesmo nome, coordenação e mês)`,
			);
		}

		const noBanco = dados<{
			nome_projeto: string;
			coordenacao: string;
			mes_venda: string;
		}>(
			await supabase
				.from("projeto_vendido")
				.select("nome_projeto, coordenacao, mes_venda")
				.eq("gestao", g.id),
			`contratos de ${g.id} no banco`,
		);
		if (!noBanco) continue;

		const doBanco = noBanco.map(chaveProjeto);
		const sobrando = doBanco.filter((n) => !naPlanilha.has(n));
		const faltando = [...naPlanilha].filter((n) => !doBanco.includes(n));

		conferir(
			sobrando.length === 0 && faltando.length === 0,
			`${g.id}: banco (${doBanco.length}) e planilha (${naPlanilha.size}) coincidem`,
			[
				sobrando.length
					? `sobrando: ${sobrando.slice(0, 5).map((n) => `"${n}"`).join(", ")}`
					: "",
				faltando.length
					? `faltando: ${faltando.slice(0, 5).map((n) => `"${n}"`).join(", ")}`
					: "",
			]
				.filter(Boolean)
				.join(" · "),
		);
	}

	// ── 5. Vendedores órfãos ──────────────────────────────────────
	const vendedores = await todasAsLinhas<{
		id_vendedor: number;
		nome_vendedor: string;
	}>("vendedores", (de, ate) =>
		supabase
			.from("vendedor")
			.select("id_vendedor, nome_vendedor")
			.order("id_vendedor", { ascending: true })
			.range(de, ate),
		"vendedor",
	);
	const deProjeto = await idsVinculados("projeto_vendedor");
	const deCard = await idsVinculados("card_vendedor");

	if (vendedores && deProjeto && deCard) {
		const comVinculo = new Set([...deProjeto, ...deCard]);
		const orfaos = vendedores.filter((v) => !comVinculo.has(v.id_vendedor));
		conferir(
			orfaos.length === 0,
			`nenhum vendedor sem vínculo (${vendedores.length} cadastrados)`,
			`${orfaos.length} órfão(s): ${orfaos.slice(0, 6).map((v) => v.nome_vendedor).join(", ")}`,
		);
	}

	// ── 6. Procedência dos cards (F6) ─────────────────────────────
	// Card sem `pipe_id` não tem como ser interpretado: é o pipe que define quais
	// etapas foram instrumentadas. Sem ele, o cálculo assume que todas foram — e
	// um card do CRM antigo apareceria como tendo passado por "Contato aberto",
	// fase que nunca existiu lá.
	const cardsSemPipe = await supabase
		.from("card")
		.select("*", { count: "exact", head: true })
		.is("pipe_id", null);

	if (cardsSemPipe.error) {
		naoVerificados.push(
			`procedência dos cards — ${cardsSemPipe.error.message}. ` +
				`Aplique supabase/migrations/0004_multi_pipe_e_fuso.sql.`,
		);
	} else {
		conferir(
			(cardsSemPipe.count ?? 0) === 0,
			"todo card tem pipe de origem declarado",
			`${cardsSemPipe.count} sem pipe_id — rode scripts/backfill-pipefy.ts`,
		);

		// Pipe que está no banco mas não no registry: ninguém sabe interpretar.
		// PAGINADO: são 2842 cards. Sem paginar, a checagem enxergaria só os mil
		// primeiros e daria ✓ por não ter olhado o resto.
		const pipesNoBanco = await todasAsLinhas<{
			pipe_id: string | null;
			data_criacao: string | null;
		}>("pipes presentes em card", (de, ate) =>
			supabase
				.from("card")
				.select("pipe_id, data_criacao")
				.not("pipe_id", "is", null)
				.order("id_card", { ascending: true })
				.range(de, ate),
		);
		if (pipesNoBanco) {
			const conhecidos = new Set(todosOsPipes().map((p) => p.pipeId));
			const desconhecidos = [
				...new Set(pipesNoBanco.map((r) => r.pipe_id).filter(Boolean)),
			].filter((p) => !conhecidos.has(p as string));
			conferir(
				desconhecidos.length === 0,
				"todo pipe presente em card está no registry",
				desconhecidos.join(", "),
			);

			// ── 6b. Cobertura declarada × cobertura real ──────────────
			// A declaração em fontes/cobertura.ts é o que faz a tela dizer "não foi
			// medido" em vez de mostrar zero. Se ela discorda dos cards que estão
			// no banco, a tela está afirmando algo falso com toda a confiança.
			for (const p of todosOsPipes()) {
				const datas = pipesNoBanco
					.filter((r) => r.pipe_id === p.pipeId && r.data_criacao)
					.map((r) => new Date(r.data_criacao as string).getTime())
					.filter((t) => Number.isFinite(t));

				if (datas.length === 0) {
					naoVerificados.push(
						`cobertura declarada do pipe "${p.nome}" — nenhum card com data no banco`,
					);
					continue;
				}

				const decl = COBERTURAS.find(
					(c) => c.fonteTipo === "pipefy" && c.fonteRef === p.pipeId,
				);
				if (!decl) {
					problemas.push(
						`pipe "${p.nome}" está no registry mas não declara cobertura em fontes/cobertura.ts`,
					);
					continue;
				}

				const primeiro = Math.min(...datas);
				const ultimo = Math.max(...datas);
				const de = new Date(decl.inicioISO).getTime();
				const ate = decl.fimISO
					? new Date(decl.fimISO).getTime()
					: Number.POSITIVE_INFINITY;
				const dia = (t: number) => new Date(t).toISOString().slice(0, 10);

				conferir(
					primeiro >= de && ultimo <= ate,
					`cobertura declarada do pipe "${p.nome}" contém todos os seus cards`,
					`cards de ${dia(primeiro)} a ${dia(ultimo)}, declarado ` +
						`${decl.inicioISO.slice(0, 10)} a ${decl.fimISO?.slice(0, 10) ?? "aberto"}`,
				);
			}
		}
	}

	// ── 7. Rastro de ingestão (F5) ────────────────────────────────
	// A detecção usa um SELECT de verdade. `head: true` numa tabela inexistente
	// devolve `error: null` no PostgREST, e foi assim que a versão anterior
	// concluiu que o rastro existia quando a migration nem tinha sido aplicada.
	const execucoes = await supabase
		.from("ingestao_execucao")
		.select("id_execucao, status, iniciado_em, fonte_ref, gestao")
		.limit(1);

	if (execucoes.error) {
		naoVerificados.push(
			`rastro de ingestão — ${execucoes.error.message}. ` +
				`Aplique supabase/migrations/0003_rastro_de_ingestao.sql.`,
		);
	} else {
		const semLinhagem = dados<{ nome_projeto: string }>(
			await supabase
				.from("projeto_vendido")
				.select("nome_projeto")
				.is("origem_ref", null),
			"linhagem de projeto_vendido",
		);
		if (semLinhagem) {
			conferir(
				semLinhagem.length === 0,
				"toda linha de projeto_vendido tem origem declarada",
				`${semLinhagem.length} sem origem_ref — recarregue com o backfill`,
			);
		}

		const metasSemLinhagem = dados<{ periodo: string }>(
			await supabase.from("meta").select("periodo").is("origem_ref", null),
			"linhagem de meta",
		);
		if (metasSemLinhagem) {
			conferir(
				metasSemLinhagem.length === 0,
				"toda meta tem origem declarada",
				`${metasSemLinhagem.length} sem origem_ref`,
			);
		}

		// Os contadores precisam fechar entre si. Uma tabela de auditoria com
		// aritmética que não bate não serve para auditar nada — e já esteve
		// errada aqui: `lidas=100, aceitas=135`, aceitas maior que lidas, porque
		// os dois contavam universos diferentes.
		//
		// `linhas_rejeitadas` conta LINHAS rejeitadas, em toda fonte — no Pipefy,
		// só as rejeições de card, não as de transição (ver Contagens.rejeitadas).
		// Com isso a identidade volta a valer em qualquer fonte.
		//
		// A execução #7 é anterior a essa distinção: registrou 1608 cards lidos,
		// 1608 aceitos e 1608 transições "Start form" rejeitadas, e por isso não
		// fecha. Nada ali estava errado além da conta.
		const contagens = dados<{
			id_execucao: number;
			gestao: string | null;
			fonte_tipo: string;
			linhas_lidas: number;
			linhas_aceitas: number;
			linhas_rejeitadas: number;
			linhas_ignoradas: number;
		}>(
			await supabase
				.from("ingestao_execucao")
				.select(
					"id_execucao, gestao, fonte_tipo, linhas_lidas, linhas_aceitas, linhas_rejeitadas, linhas_ignoradas",
				)
				.eq("status", "ok"),
			"contagens das execuções",
		);
		if (contagens) {
			const somaDe = (e: (typeof contagens)[number]) =>
				e.linhas_aceitas + e.linhas_rejeitadas + e.linhas_ignoradas;

			// #7 e as execuções anteriores à separação entre rejeição de card e de
			// transição não têm como fechar. Ignorá-las não é varrer para debaixo
			// do tapete: a conta delas foi feita com outra definição, e um ✗ que
			// não tem conserto é ruído que ensina a ignorar os ✗ que têm.
			const CORTE_CONTAGEM_NOVA = 13;
			const incoerentes = contagens.filter(
				(e) => e.id_execucao > CORTE_CONTAGEM_NOVA && e.linhas_lidas !== somaDe(e),
			);
			conferir(
				incoerentes.length === 0,
				"em toda execução, lidas = aceitas + rejeitadas + ignoradas",
				incoerentes
					.map(
						(e) =>
							`#${e.id_execucao} (${e.fonte_tipo}/${e.gestao ?? "—"}): ` +
							`${e.linhas_lidas} ≠ ${somaDe(e)}`,
					)
					.join(", "),
			);
		}

		// A ÚLTIMA carga de cada fonte terminou bem?
		//
		// A primeira versão desta checagem perguntava "nenhuma execução com erro
		// nos últimos 7 dias", e tinha os dois defeitos possíveis ao mesmo tempo:
		// olhava só `com_erros` (uma rodada morta vira `falhou` e escapava) e
		// alarmava por falha JÁ RESOLVIDA por uma carga posterior bem-sucedida.
		//
		// O que interessa a quem lê um dash não é o histórico de tropeços, é se o
		// dado de agora está completo. Uma falha superada não muda nada; a última
		// falhada muda tudo — significa que card criado desde a última carga boa
		// não entrou, e o número na tela está velho sem avisar.
		const execucoes = dados<{
			id_execucao: number;
			fonte_ref: string;
			status: string;
			linhas_aceitas: number;
			erro: string | null;
		}>(
			await supabase
				.from("ingestao_execucao")
				.select("id_execucao, fonte_ref, status, linhas_aceitas, erro")
				.neq("status", "executando")
				.order("id_execucao", { ascending: false }),
			"última execução por fonte",
		);
		if (execucoes) {
			const ultimaPorFonte = new Map<string, (typeof execucoes)[number]>();
			for (const e of execucoes) {
				if (!ultimaPorFonte.has(e.fonte_ref)) ultimaPorFonte.set(e.fonte_ref, e);
			}
			const ruins = [...ultimaPorFonte.values()].filter((e) => e.status !== "ok");
			conferir(
				ruins.length === 0,
				"a última carga de cada fonte terminou sem erro",
				ruins
					.map(
						(e) =>
							`${e.fonte_ref}: #${e.id_execucao} ${e.status}` +
							` (${e.linhas_aceitas} gravada(s))${e.erro ? ` — ${e.erro}` : ""}`,
					)
					.join(" · ") + ". Rode a carga de novo.",
			);
		}

		const penduradas = dados<{ id_execucao: number; gestao: string | null }>(
			await supabase
				.from("ingestao_execucao")
				.select("id_execucao, gestao")
				.eq("status", "executando")
				.lt("iniciado_em", new Date(Date.now() - 3600_000).toISOString()),
			"execuções penduradas",
		);
		if (penduradas) {
			conferir(
				penduradas.length === 0,
				"nenhuma execução pendurada há mais de uma hora",
				penduradas.map((e) => `#${e.id_execucao} (${e.gestao ?? "—"})`).join(", "),
			);
		}
	}

	// ── 8. Snapshots de período (F7) ──────────────────────────────
	const snaps = dados<Record<string, unknown>>(
		await supabase
			.from("snapshot_periodo")
			.select("*")
			.order("id_snapshot", { ascending: true }),
		"snapshots de período",
	);

	if (snaps) {
		// INTEGRIDADE. O gatilho da 0006 recusa UPDATE, então hash que não bate
		// significa alteração por fora do aplicativo: acesso direto ao banco,
		// restore de dump, migração mal feita. É a diferença entre "a fonte mudou"
		// (legítimo, acontece) e "o congelado foi mexido" (nunca deveria).
		const adulterados = snaps.filter((row) => {
			const m = row.metricas as MetricasCongeladas;
			return hashMetricas(m) !== (row.hash_metricas as string);
		});
		conferir(
			adulterados.length === 0,
			`todo snapshot bate com o próprio hash (${snaps.length} congelado(s))`,
			adulterados
				.map((r) => `#${r.id_snapshot} ${r.gestao}/${r.tipo_periodo}/${r.periodo}`)
				.join(", "),
		);

		// DERIVA. Congelado e fonte de hoje deviam dizer a mesma coisa; quando não
		// dizem, alguém editou a planilha depois do fechamento. Pode ser correção
		// legítima — mas o número na tela deixou de ser o número da planilha, e é
		// exatamente isso que ninguém percebia antes da F7.
		if (snaps.length > 0) {
			const [vendas, metas] = await Promise.all([
				buscarVendasDoBanco(),
				buscarMetasDoBanco(),
			]);

			const comDeriva: string[] = [];
			for (const row of snaps) {
				if ((row.versao_calculo as number) !== VERSAO_CALCULO) continue;
				const snap: Snapshot = {
					idSnapshot: row.id_snapshot as number,
					gestao: row.gestao as string,
					tipoPeriodo: row.tipo_periodo as Snapshot["tipoPeriodo"],
					periodo: row.periodo as string,
					metricas: row.metricas as MetricasCongeladas,
					hashMetricas: row.hash_metricas as string,
					versaoCalculo: row.versao_calculo as number,
					geradoEm: row.gerado_em as string,
				};
				const d = compararComAFonte(snap, VERSAO_CALCULO, vendas, metas);
				if (d && d.diferencas.length > 0) {
					const ex = d.diferencas[0];
					comDeriva.push(
						`${snap.gestao}/${snap.tipoPeriodo}/${snap.periodo}: ` +
							`${d.diferencas.length} campo(s), ex. ${ex.campo} ${ex.congelado}→${ex.agora}`,
					);
				}
			}
			conferir(
				comDeriva.length === 0,
				"todo período congelado ainda bate com a fonte",
				comDeriva.slice(0, 5).join(" · "),
			);
		}

		// PENDENTES. Período que já podia ter sido congelado e não foi continua
		// exposto a reescrita silenciosa. Nota, não problema: congelar é ato
		// deliberado, e o script existe justamente para ser rodado quando se quer.
		const congelados = new Set(
			snaps.map((r) => `${r.gestao}|${r.tipo_periodo}|${r.periodo}`),
		);
		const pendentes = periodosCongelaveis().filter((p) => {
			const chave = `${p.sel.gestao}|${p.sel.tipo}|${
				p.sel.tipo === "ciclo" ? p.sel.ciclo : p.sel.tipo === "mes" ? p.sel.mes : p.sel.gestao
			}`;
			return !congelados.has(chave);
		});
		if (pendentes.length > 0) {
			notas.push(
				`${pendentes.length} período(s) fechado(s) e ainda não congelado(s). ` +
					`Rode: npx tsx scripts/congelar-periodos.ts --gravar`,
			);
		}
	}

	// ── 9. Idade do dado ──────────────────────────────────────────
	//
	// "A última carga terminou sem erro" não responde "quando foi a última
	// carga". Um agendador que simplesmente PARA não deixa execução com erro —
	// deixa ausência de execução, que é invisível para qualquer checagem que só
	// olhe o que existe. Foi o que aconteceu em agosto/2026: 64% das rodadas
	// nunca ocorreram e nada acusou, porque nenhuma delas falhou.
	const frescor = await medirFrescor();
	for (const f of frescor.fontes) {
		const limite = LIMITE_FRESCOR_HORAS[f.tipo];
		conferir(
			f.atraso <= 1,
			`${f.nome}: carregada nas últimas ${limite}h`,
			f.horasDesdeAUltima === null
				? "nunca foi carregada"
				: `última carga há ${f.horasDesdeAUltima.toFixed(1)}h`,
		);
	}

	// ── 10. O agendador principal ─────────────────────────────────
	//
	// Separado da idade do dado de propósito. O GitHub Actions ficou como rede de
	// segurança a cada 6h; se ele cobrisse a queda do pg_cron sem ninguém notar, o
	// projeto voltaria ao agendador que descarta 64% das execuções — só que agora
	// em silêncio, porque o dado pareceria fresco.
	const horasAgendador = await horasDesdeOAgendador();
	if (horasAgendador === null) {
		naoVerificados.push(
			"agendador do banco (pg_cron) — sem registro de disparo. " +
				"A view `disparo_recente` existe? (migration 0008)",
		);
	} else {
		conferir(
			horasAgendador <= LIMITE_AGENDADOR_HORAS,
			`pg_cron disparou nas últimas ${LIMITE_AGENDADOR_HORAS}h`,
			`último disparo há ${horasAgendador.toFixed(1)}h — confira ` +
				`"select jobname, schedule, active from cron.job"`,
		);
	}

	// ── Relatório ─────────────────────────────────────────────────
	console.log("Invariantes verificados:\n");
	for (const o of ok) console.log(`  ✓ ${o}`);

	if (naoVerificados.length > 0) {
		console.log(`\n? ${naoVerificados.length} NÃO verificado(s):\n`);
		for (const n of naoVerificados) console.log(`  ? ${n}`);
		console.log(
			`\n  Não confunda com "está tudo certo": estes invariantes não puderam ser checados.`,
		);
	}

	if (problemas.length > 0) {
		console.log(`\n⚠ ${problemas.length} problema(s):\n`);
		for (const p of problemas) console.log(`  ✗ ${p}`);
		console.log(
			`\nPara contratos sobrando ou faltando:\n` +
				`  npx tsx scripts/backfill-sheets.ts --gestao "<gestão>"`,
		);
	}

	if (problemas.length === 0 && naoVerificados.length === 0) {
		console.log(`\nNenhum problema encontrado.`);
	}

	if (problemas.length > 0 || naoVerificados.length > 0) process.exitCode = 1;
}

main().catch((err) => {
	console.error("\nErro:", err?.message ?? err);
	process.exit(1);
});
