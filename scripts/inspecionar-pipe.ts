// scripts/inspecionar-pipe.ts
//
// Script de DESCOBERTA (somente leitura) para mapear pipes do Pipefy.
// Não escreve nada — nem no Supabase, nem no Pipefy.
//
// Objetivo: produzir a informação necessária para escrever o MapaPipe por pipe
// (F5 do PLANO-FONTE-DA-VERDADE.md, plano histórico, no repositório privado de arquivo), comparando o pipe antigo com o atual.
// Responde três perguntas concretas:
//   1. Quais fases existem em cada pipe e como se chamam exatamente?
//   2. Quais fases o código atual ignoraria em silêncio?
//   3. Os labels de campo que os extratores procuram existem nos dois pipes?
//
// Uso:
//   npx tsx scripts/inspecionar-pipe.ts --listar            ← descobre os IDs
//   npx tsx scripts/inspecionar-pipe.ts <pipeId>
//   npx tsx scripts/inspecionar-pipe.ts <pipeIdAntigo> <pipeIdAtual>
//
// Flags:
//   --listar           Lista todos os pipes visíveis pelo token e sai.
//   --amostra <n>      Cards amostrados por fase para ler labels reais (default 2).
//   --json <caminho>   Grava o resultado estruturado em JSON.
//
// Sem argumentos de pipe, usa PIPEFY_PIPE_ID do .env.local.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { writeFileSync } from "node:fs";

const PIPEFY_API_URL = "https://api.pipefy.com/graphql";
const PIPEFY_TOKEN = process.env.PIPEFY_TOKEN;

// ─── Snapshot do mapeamento ATUAL ─────────────────────────────────
//
// Cópia do que hoje existe em src/lib/sync-pipefy.ts, usada só para comparação.
// O objetivo desta descoberta é justamente SUBSTITUIR estas constantes por um
// mapa por pipe — elas estão aqui como referência do estado atual, não como
// fonte de verdade.

const ETAPAS_MAP_ATUAL: Record<string, string> = {
	"1. Oportunidade": "Oportunidade",
	"2. Contato aberto": "Contato aberto",
	"3. Pré-diagnóstico feito": "Pré-diagnóstico feito",
	"4. Dignóstico feito": "Diagnóstico feito",
	"4. Diagnóstico feito": "Diagnóstico feito",
	"5. Precificação/Aprovação em andamento": "Precificação/Aprovação em andamento",
	"6. Proposta comercial feita": "Proposta comercial feita",
	"7. Follow-up": "Follow-up",
	Venda: "Venda",
};

const ETAPAS_TERMINAIS_ATUAL: Record<string, string> = {
	Perdido: "Perdido",
	Pausado: "Pausado",
};

const FASES_IGNORADAS_ATUAL = ["Start form"];

const ETAPA_LOOKUP_ATUAL: Record<string, string> = {
	...ETAPAS_MAP_ATUAL,
	...ETAPAS_TERMINAIS_ATUAL,
};

/** As 8 etapas comerciais canônicas, na ordem do funil. */
const ETAPAS_CANONICAS = [
	"Oportunidade",
	"Contato aberto",
	"Pré-diagnóstico feito",
	"Diagnóstico feito",
	"Precificação/Aprovação em andamento",
	"Proposta comercial feita",
	"Follow-up",
	"Venda",
];

/** Labels que os extratores atuais procuram (comparação case-insensitive + trim). */
const LABELS_PROCURADOS = [
	"coordenação",
	"responsável",
	"valor da proposta",
	"canal de aquisição",
];

// ─── Argumentos ───────────────────────────────────────────────────

interface Args {
	pipeIds: string[];
	amostra: number;
	listar: boolean;
	json?: string;
}

function parsearArgs(argv: string[]): Args {
	const pipeIds: string[] = [];
	let amostra = 2;
	let listar = false;
	let json: string | undefined;

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--amostra") amostra = parseInt(argv[++i], 10);
		else if (a === "--json") json = argv[++i];
		else if (a === "--listar") listar = true;
		else if (a.startsWith("--")) throw new Error(`Flag desconhecida: ${a}`);
		else pipeIds.push(a);
	}

	if (listar) return { pipeIds, amostra, listar, json };

	if (pipeIds.length === 0 && process.env.PIPEFY_PIPE_ID) {
		pipeIds.push(process.env.PIPEFY_PIPE_ID);
	}

	if (pipeIds.length === 0) {
		throw new Error(
			"Informe ao menos um pipeId, ou defina PIPEFY_PIPE_ID no .env.local.\n" +
				"Para descobrir os IDs disponíveis: npx tsx scripts/inspecionar-pipe.ts --listar",
		);
	}

	return { pipeIds, amostra, listar, json };
}

// ─── API ──────────────────────────────────────────────────────────

async function fetchPipefy(query: string): Promise<any> {
	if (!PIPEFY_TOKEN) throw new Error("PIPEFY_TOKEN é obrigatório no .env.local");

	const resp = await fetch(PIPEFY_API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${PIPEFY_TOKEN}`,
		},
		body: JSON.stringify({ query }),
	});

	if (!resp.ok) throw new Error(`Pipefy API ${resp.status}`);

	const json = await resp.json();
	if (json.errors?.length) throw new Error(`Pipefy GraphQL: ${json.errors[0].message}`);
	return json.data;
}

/** Consulta rica; degrada para a mínima se o schema do pipe não aceitar algum campo. */
async function buscarPipe(pipeId: string): Promise<any> {
	const rica = `query {
    pipe(id: ${pipeId}) {
      id
      name
      phases { id name cards_count done fields { id label type required } }
      start_form_fields { id label type }
    }
  }`;

	try {
		return (await fetchPipefy(rica)).pipe;
	} catch (err) {
		console.warn(
			`  (consulta completa falhou — ${err instanceof Error ? err.message : String(err)}; caindo para a mínima)`,
		);
		const minima = `query { pipe(id: ${pipeId}) { id name phases { id name } } }`;
		return (await fetchPipefy(minima)).pipe;
	}
}

/**
 * Lista todos os pipes visíveis pelo token, por organização.
 * É a forma confiável de descobrir o ID do pipe antigo — a URL do Pipefy só
 * ajuda se você já souber navegar até ele.
 */
async function listarPipes(): Promise<void> {
	const rica = `query {
    organizations {
      id
      name
      pipes { id name cards_count created_at }
    }
  }`;

	let orgs: any[];
	try {
		orgs = (await fetchPipefy(rica)).organizations ?? [];
	} catch (err) {
		console.warn(`  (consulta completa falhou — ${err instanceof Error ? err.message : String(err)}; caindo para a mínima)`);
		const minima = `query { organizations { id name pipes { id name } } }`;
		orgs = (await fetchPipefy(minima)).organizations ?? [];
	}

	if (orgs.length === 0) {
		console.log("\nNenhuma organização visível para este token.");
		return;
	}

	for (const org of orgs) {
		console.log(`\nOrganização ${org.id} — "${org.name}"`);
		const pipes = org.pipes ?? [];
		if (pipes.length === 0) {
			console.log("  (sem pipes visíveis)");
			continue;
		}
		console.log(`  ${pipes.length} pipe(s):\n`);
		for (const p of pipes) {
			const atual = p.id === process.env.PIPEFY_PIPE_ID ? "  ← PIPEFY_PIPE_ID atual" : "";
			const cards = typeof p.cards_count === "number" ? `${p.cards_count} cards` : "";
			const criado = p.created_at ? ` · criado em ${String(p.created_at).slice(0, 10)}` : "";
			console.log(`    ${String(p.id).padEnd(12)} "${p.name}"`);
			console.log(`      ${cards}${criado}${atual}`);
		}
	}

	console.log(
		`\nUse o ID da coluna esquerda:\n  npx tsx scripts/inspecionar-pipe.ts <pipeAntigo> <pipeAtual> --amostra 3`,
	);
}

async function amostrarCards(phaseId: string, n: number): Promise<any[]> {
	if (n <= 0) return [];
	const query = `query {
    phase(id: "${phaseId}") {
      cards(first: ${n}) {
        edges { node {
          id title createdAt
          current_phase { name }
          fields { field { id label } value array_value }
        } }
      }
    }
  }`;

	try {
		const data = await fetchPipefy(query);
		return (data.phase?.cards?.edges ?? []).map((e: any) => e.node);
	} catch {
		return [];
	}
}

// ─── Análise ──────────────────────────────────────────────────────

interface FaseAnalisada {
	id: string;
	nome: string;
	cards: number | null;
	done: boolean | null;
	canonica: string | null; // para onde o mapa ATUAL mandaria
	situacao: "mapeada" | "terminal" | "ignorada" | "NÃO MAPEADA";
	camposDefinidos: { label: string; tipo: string }[];
	labelsVistosEmCards: string[];
}

interface PipeAnalisado {
	id: string;
	nome: string;
	fases: FaseAnalisada[];
	labelsUnicos: string[];
	canonicasAusentes: string[];
	naoMapeadas: string[];
	labelsProcuradosFaltando: string[];
	dataCardMaisAntigoNaAmostra: string | null;
	totalCardsConhecido: number | null;
}

function normalizarLabel(s: string): string {
	return s.toLowerCase().trim();
}

async function analisarPipe(pipeId: string, amostra: number): Promise<PipeAnalisado> {
	console.log(`\n[Pipefy] Consultando pipe ${pipeId}...`);
	const pipe = await buscarPipe(pipeId);

	const fases: FaseAnalisada[] = [];
	const labelsUnicos = new Set<string>();
	let maisAntigo: string | null = null;
	let totalCards = 0;
	let temContagem = false;

	for (const fase of pipe.phases ?? []) {
		const canonica = ETAPA_LOOKUP_ATUAL[fase.name] ?? null;

		let situacao: FaseAnalisada["situacao"];
		if (FASES_IGNORADAS_ATUAL.includes(fase.name)) situacao = "ignorada";
		else if (ETAPAS_TERMINAIS_ATUAL[fase.name]) situacao = "terminal";
		else if (canonica) situacao = "mapeada";
		else situacao = "NÃO MAPEADA";

		const camposDefinidos = (fase.fields ?? []).map((f: any) => ({
			label: f.label,
			tipo: f.type ?? "?",
		}));
		camposDefinidos.forEach((c: { label: string }) => labelsUnicos.add(c.label));

		// Labels definidos no pipe nem sempre são os que aparecem nos cards —
		// e é contra o label do CARD que extrairCampo() casa. Por isso amostramos.
		const cards = await amostrarCards(fase.id, amostra);
		const labelsEmCards = new Set<string>();
		for (const card of cards) {
			for (const f of card.fields ?? []) {
				if (f.field?.label) {
					labelsEmCards.add(f.field.label);
					labelsUnicos.add(f.field.label);
				}
			}
			if (card.createdAt && (!maisAntigo || card.createdAt < maisAntigo)) {
				maisAntigo = card.createdAt;
			}
		}

		if (typeof fase.cards_count === "number") {
			totalCards += fase.cards_count;
			temContagem = true;
		}

		fases.push({
			id: fase.id,
			nome: fase.name,
			cards: typeof fase.cards_count === "number" ? fase.cards_count : null,
			done: typeof fase.done === "boolean" ? fase.done : null,
			canonica,
			situacao,
			camposDefinidos,
			labelsVistosEmCards: [...labelsEmCards],
		});
	}

	const cobertas = new Set(
		fases.map((f) => f.canonica).filter((c): c is string => c !== null),
	);
	const canonicasAusentes = ETAPAS_CANONICAS.filter((e) => !cobertas.has(e));
	const naoMapeadas = fases
		.filter((f) => f.situacao === "NÃO MAPEADA")
		.map((f) => f.nome);

	const normalizados = new Set([...labelsUnicos].map(normalizarLabel));
	const labelsProcuradosFaltando = LABELS_PROCURADOS.filter(
		(l) => !normalizados.has(normalizarLabel(l)),
	);

	return {
		id: String(pipe.id),
		nome: pipe.name,
		fases,
		labelsUnicos: [...labelsUnicos].sort(),
		canonicasAusentes,
		naoMapeadas,
		labelsProcuradosFaltando,
		dataCardMaisAntigoNaAmostra: maisAntigo,
		totalCardsConhecido: temContagem ? totalCards : null,
	};
}

// ─── Impressão ────────────────────────────────────────────────────

function imprimirPipe(p: PipeAnalisado) {
	console.log(`\n${"═".repeat(78)}`);
	console.log(`PIPE ${p.id} — "${p.nome}"`);
	console.log("═".repeat(78));

	if (p.totalCardsConhecido !== null) {
		console.log(`  Total de cards: ${p.totalCardsConhecido}`);
	}
	if (p.dataCardMaisAntigoNaAmostra) {
		console.log(
			`  Card mais antigo NA AMOSTRA: ${p.dataCardMaisAntigoNaAmostra}`,
		);
		console.log(
			`    (amostra pequena — não é o mínimo real do pipe; só o backfill completo confirma a cobertura)`,
		);
	}

	console.log(`\n  Fases (${p.fases.length}), na ordem do pipe:\n`);
	for (const f of p.fases) {
		const marca =
			f.situacao === "NÃO MAPEADA"
				? "⚠ "
				: f.situacao === "ignorada"
					? "· "
					: f.situacao === "terminal"
						? "◼ "
						: "✓ ";
		const contagem = f.cards !== null ? ` ${String(f.cards).padStart(4)} cards` : "";
		const destino = f.canonica ? ` → "${f.canonica}"` : "";
		console.log(`    ${marca}"${f.nome}"${contagem}`);
		console.log(`        id ${f.id} · ${f.situacao}${destino}`);
		if (f.camposDefinidos.length > 0) {
			console.log(
				`        campos definidos: ${f.camposDefinidos.map((c) => `${c.label} [${c.tipo}]`).join(", ")}`,
			);
		}
		if (f.labelsVistosEmCards.length > 0) {
			console.log(
				`        labels vistos em cards: ${f.labelsVistosEmCards.join(", ")}`,
			);
		}
	}

	console.log(`\n  ── Diagnóstico contra o mapeamento atual (sync-pipefy.ts) ──`);

	if (p.naoMapeadas.length > 0) {
		console.log(`\n  ⚠ Fases NÃO MAPEADAS — hoje os cards delas seriam descartados`);
		console.log(`    em silêncio por sync-pipefy.ts:248 (return false):`);
		for (const n of p.naoMapeadas) console.log(`      - "${n}"`);
	} else {
		console.log(`\n  ✓ Todas as fases deste pipe estão no mapeamento atual.`);
	}

	if (p.canonicasAusentes.length > 0) {
		console.log(`\n  ⚠ Etapas canônicas SEM fase correspondente neste pipe:`);
		for (const e of p.canonicasAusentes) console.log(`      - "${e}"`);
		console.log(
			`    Estas entram em etapasNaoInstrumentadas do MapaPipe — devem renderizar "—",`,
		);
		console.log(`    nunca 0% (ver F5 do plano).`);
	} else {
		console.log(`\n  ✓ Todas as 8 etapas canônicas têm fase neste pipe.`);
	}

	console.log(`\n  Labels de campo procurados pelos extratores atuais:`);
	for (const l of LABELS_PROCURADOS) {
		const achado = p.labelsUnicos.find(
			(u) => normalizarLabel(u) === normalizarLabel(l),
		);
		console.log(
			achado
				? `      ✓ "${l}"  → encontrado como "${achado}"`
				: `      ⚠ "${l}"  → NÃO ENCONTRADO neste pipe`,
		);
	}

	console.log(`\n  Todos os labels de campo vistos (${p.labelsUnicos.length}):`);
	for (const l of p.labelsUnicos) console.log(`      - "${l}"`);

	// Esqueleto do MapaPipe para colar e ajustar.
	console.log(`\n  ── Esqueleto de MapaPipe (revise antes de usar) ──\n`);
	console.log(`    {`);
	console.log(`      pipeId: ${JSON.stringify(p.id)},`);
	console.log(`      fasesComerciais: {`);
	for (const f of p.fases) {
		if (f.situacao === "ignorada" || ETAPAS_TERMINAIS_ATUAL[f.nome]) continue;
		const destino = f.canonica ?? "TODO_DEFINIR";
		console.log(`        ${JSON.stringify(f.nome)}: ${JSON.stringify(destino)},`);
	}
	console.log(`      },`);
	console.log(`      fasesTerminais: {`);
	for (const f of p.fases) {
		if (ETAPAS_TERMINAIS_ATUAL[f.nome]) {
			console.log(`        ${JSON.stringify(f.nome)}: ${JSON.stringify(f.nome)},`);
		}
	}
	console.log(`      },`);
	console.log(
		`      fasesIgnoradas: ${JSON.stringify(p.fases.filter((f) => f.situacao === "ignorada").map((f) => f.nome))},`,
	);
	console.log(
		`      etapasNaoInstrumentadas: ${JSON.stringify(p.canonicasAusentes)},`,
	);
	console.log(`      campos: { /* preencher com os labels reais listados acima */ },`);
	console.log(`    }`);
}

function imprimirComparacao(pipes: PipeAnalisado[]) {
	console.log(`\n${"═".repeat(78)}`);
	console.log(`COMPARAÇÃO ENTRE PIPES`);
	console.log("═".repeat(78));

	const [a, b] = pipes;

	console.log(`\n  A = ${a.id} "${a.nome}"`);
	console.log(`  B = ${b.id} "${b.nome}"`);

	const nomesA = new Set(a.fases.map((f) => f.nome));
	const nomesB = new Set(b.fases.map((f) => f.nome));

	const soA = [...nomesA].filter((n) => !nomesB.has(n));
	const soB = [...nomesB].filter((n) => !nomesA.has(n));
	const comuns = [...nomesA].filter((n) => nomesB.has(n));

	console.log(`\n  Fases só em A (${soA.length}):`);
	soA.forEach((n) => console.log(`      - "${n}"`));
	console.log(`\n  Fases só em B (${soB.length}):`);
	soB.forEach((n) => console.log(`      - "${n}"`));
	console.log(`\n  Fases com nome idêntico nos dois (${comuns.length}):`);
	comuns.forEach((n) => console.log(`      - "${n}"`));

	// Etapas canônicas cobertas por um e não pelo outro — a decisão de
	// "etapa não instrumentada" do plano sai daqui.
	const cobA = new Set(a.fases.map((f) => f.canonica).filter(Boolean));
	const cobB = new Set(b.fases.map((f) => f.canonica).filter(Boolean));
	const assimetricas = ETAPAS_CANONICAS.filter(
		(e) => cobA.has(e) !== cobB.has(e),
	);
	if (assimetricas.length > 0) {
		console.log(`\n  ⚠ Etapas canônicas cobertas por só um dos pipes:`);
		for (const e of assimetricas) {
			console.log(
				`      - "${e}"  (A: ${cobA.has(e) ? "sim" : "NÃO"} · B: ${cobB.has(e) ? "sim" : "NÃO"})`,
			);
		}
		console.log(
			`    Comparações de funil entre períodos destes dois pipes precisam tratar`,
		);
		console.log(`    estas etapas como não instrumentadas, não como conversão zero.`);
	}

	const labA = new Set(a.labelsUnicos.map(normalizarLabel));
	const labB = new Set(b.labelsUnicos.map(normalizarLabel));
	const labSoA = a.labelsUnicos.filter((l) => !labB.has(normalizarLabel(l)));
	const labSoB = b.labelsUnicos.filter((l) => !labA.has(normalizarLabel(l)));

	console.log(`\n  Labels de campo só em A (${labSoA.length}):`);
	labSoA.forEach((l) => console.log(`      - "${l}"`));
	console.log(`\n  Labels de campo só em B (${labSoB.length}):`);
	labSoB.forEach((l) => console.log(`      - "${l}"`));
}

// ─── Execução ─────────────────────────────────────────────────────

async function main() {
	const args = parsearArgs(process.argv.slice(2));

	console.log("=== Inspeção de pipe do Pipefy (somente leitura) ===");

	if (args.listar) {
		await listarPipes();
		return;
	}

	console.log(`Pipes: ${args.pipeIds.join(", ")}`);
	console.log(`Amostra por fase: ${args.amostra} card(s)`);

	const analisados: PipeAnalisado[] = [];
	for (const id of args.pipeIds) {
		const p = await analisarPipe(id, args.amostra);
		analisados.push(p);
		imprimirPipe(p);
	}

	if (analisados.length >= 2) imprimirComparacao(analisados.slice(0, 2));

	if (args.json) {
		writeFileSync(
			args.json,
			JSON.stringify({ pipes: analisados, geradoEm: new Date().toISOString() }, null, 2),
			"utf8",
		);
		console.log(`\nJSON gravado em ${args.json}`);
	}

	console.log(`\n=== Fim ===`);
}

main().catch((err) => {
	console.error("\nErro:", err.message ?? err);
	process.exit(1);
});
