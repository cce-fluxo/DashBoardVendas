// scripts/inspecionar-planilha.ts
//
// Script de DESCOBERTA (somente leitura) para mapear planilhas oficiais.
// Não escreve nada — nem no Supabase, nem na planilha.
//
// Objetivo: produzir a informação necessária para preencher o registry de
// fontes (F1 do PLANO-FONTE-DA-VERDADE.md, plano histórico, no repositório privado de arquivo) a partir do que a planilha REALMENTE
// tem, em vez de suposição.
//
// Uso:
//   npx tsx scripts/inspecionar-planilha.ts <spreadsheetId>
//   npx tsx scripts/inspecionar-planilha.ts <spreadsheetId> --aba "Contratos"
//   npx tsx scripts/inspecionar-planilha.ts <id> --aba "Contratos" --aba "Metas por coordenação"
//
// Flags:
//   --aba <nome>       Analisa só esta aba (repetível). Sem isso, analisa todas.
//   --linhas <n>       Linhas do dump bruto (default 12).
//   --cabecalho <n>    Força a linha de cabeçalho (1-base), sobrepondo a heurística.
//   --json <caminho>   Grava o resultado estruturado em JSON.
//
// Requer GOOGLE_SERVICE_ACCOUNT_EMAIL e GOOGLE_PRIVATE_KEY no .env.local,
// e a planilha compartilhada com essa service account (leitor basta).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { writeFileSync } from "node:fs";
import { google } from "googleapis";

// ─── Argumentos ───────────────────────────────────────────────────

interface Args {
	spreadsheetId: string;
	abas: string[];
	linhas: number;
	cabecalho?: number;
	json?: string;
}

function parsearArgs(argv: string[]): Args {
	const positional: string[] = [];
	const abas: string[] = [];
	let linhas = 12;
	let cabecalho: number | undefined;
	let json: string | undefined;

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--aba") abas.push(argv[++i]);
		else if (a === "--linhas") linhas = parseInt(argv[++i], 10);
		else if (a === "--cabecalho") cabecalho = parseInt(argv[++i], 10);
		else if (a === "--json") json = argv[++i];
		else if (a.startsWith("--")) throw new Error(`Flag desconhecida: ${a}`);
		else positional.push(a);
	}

	if (!positional[0]) {
		throw new Error(
			"Uso: npx tsx scripts/inspecionar-planilha.ts <spreadsheetId> [--aba <nome>] [--linhas <n>] [--cabecalho <n>] [--json <caminho>]",
		);
	}

	return { spreadsheetId: positional[0], abas, linhas, cabecalho, json };
}

// ─── Utilitários ──────────────────────────────────────────────────

/** 0 → "A", 25 → "Z", 26 → "AA" */
function letraColuna(indice: number): string {
	let n = indice;
	let s = "";
	do {
		s = String.fromCharCode(65 + (n % 26)) + s;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return s;
}

/** Normalização usada para casar cabeçalho: sem acento, minúsculo, espaço colapsado. */
function normalizar(s: string): string {
	return s
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

/** Nome de aba dentro de um range A1 precisa de aspas simples; aspas internas dobram. */
function rangeAba(nome: string): string {
	return `'${nome.replace(/'/g, "''")}'`;
}

function truncar(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, max - 1) + "…";
}

// ─── Cliente ──────────────────────────────────────────────────────

async function getSheetsClient() {
	const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
	const key = process.env.GOOGLE_PRIVATE_KEY;
	if (!email || !key) {
		throw new Error(
			"GOOGLE_SERVICE_ACCOUNT_EMAIL e GOOGLE_PRIVATE_KEY são obrigatórios no .env.local",
		);
	}

	const auth = new google.auth.GoogleAuth({
		credentials: { client_email: email, private_key: key.replace(/\\n/g, "\n") },
		scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
	});

	return google.sheets({ version: "v4", auth });
}

// ─── Detecção de cabeçalho ────────────────────────────────────────
//
// Planilha oficial costuma ter linhas de título/merge antes do cabeçalho real.
// Heurística: o cabeçalho é a linha com mais células preenchidas, distintas
// entre si e predominantemente textuais. Linhas de dado perdem pontos por
// terem células numéricas/data; linhas de título perdem por terem poucas células.

const RE_NUMERO = /^-?[\d.,]+$/;
const RE_DATA = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
const RE_MOEDA = /^R\$\s?[\d.,]+$/i;

function pontuarComoCabecalho(linha: string[]): number {
	const preenchidas = linha.filter((c) => c?.trim());
	if (preenchidas.length === 0) return -1;

	const distintas = new Set(preenchidas.map((c) => normalizar(c)));
	const pareceDado = preenchidas.filter((c) => {
		const v = c.trim();
		return RE_NUMERO.test(v) || RE_DATA.test(v) || RE_MOEDA.test(v);
	}).length;

	let pontos = preenchidas.length;
	if (distintas.size === preenchidas.length) pontos += preenchidas.length * 0.5;
	pontos -= pareceDado * 2;
	return pontos;
}

interface CandidatoCabecalho {
	linha: number; // 1-base
	pontos: number;
	preenchidas: number;
	amostra: string;
}

function detectarCabecalho(
	grade: string[][],
	limite = 12,
): { escolhida: number; candidatos: CandidatoCabecalho[] } {
	const candidatos: CandidatoCabecalho[] = [];
	const ate = Math.min(limite, grade.length);

	for (let i = 0; i < ate; i++) {
		const linha = grade[i] ?? [];
		candidatos.push({
			linha: i + 1,
			pontos: Math.round(pontuarComoCabecalho(linha) * 10) / 10,
			preenchidas: linha.filter((c) => c?.trim()).length,
			amostra: truncar(
				linha
					.filter((c) => c?.trim())
					.slice(0, 4)
					.join(" | "),
				70,
			),
		});
	}

	const melhor = candidatos.reduce(
		(a, b) => (b.pontos > a.pontos ? b : a),
		candidatos[0] ?? { linha: 1, pontos: -1, preenchidas: 0, amostra: "" },
	);

	return { escolhida: melhor.linha, candidatos };
}

// ─── Perfil de coluna ─────────────────────────────────────────────

const COORDENACOES_PADRAO = ["CCE", "ACE", "MNP", "QAB", "PRO"];
const LIMITE_BAIXA_CARDINALIDADE = 12;

interface PerfilColuna {
	letra: string;
	indice: number;
	cabecalho: string;
	cabecalhoNormalizado: string;
	preenchidas: number;
	vazias: number;
	distintas: number;
	tipoDominante: string;
	tipoCelula: "texto" | "data/número nativa" | "indefinido";
	amostras: string[];
	valoresDistintos?: string[];
	naoConformes: string[];
	alertas: string[];
}

function classificarValor(v: string): string {
	const s = v.trim();
	if (!s) return "vazio";
	if (RE_MOEDA.test(s)) return "moeda";
	if (RE_DATA.test(s)) return "data";
	if (RE_NUMERO.test(s)) return "número";
	if (/^(sim|n[aã]o)$/i.test(s)) return "booleano SIM/NÃO";
	return "texto";
}

function perfilarColuna(
	indice: number,
	cabecalho: string,
	valoresFormatados: string[],
	valoresBrutos: string[],
): PerfilColuna {
	const preenchidos = valoresFormatados.filter((v) => v?.trim());
	const distintos = [...new Set(preenchidos.map((v) => v.trim()))];

	// Tipo dominante entre os valores preenchidos.
	const contagem: Record<string, number> = {};
	for (const v of preenchidos) {
		const t = classificarValor(v);
		contagem[t] = (contagem[t] ?? 0) + 1;
	}
	const ordenados = Object.entries(contagem).sort((a, b) => b[1] - a[1]);
	const tipoDominante = ordenados[0]
		? `${ordenados[0][0]} (${ordenados[0][1]}/${preenchidos.length})`
		: "—";

	// Valores que fogem do tipo dominante — é onde o parser atual quebraria.
	const tipoTop = ordenados[0]?.[0];
	const naoConformes = tipoTop
		? [
				...new Set(
					preenchidos.filter((v) => classificarValor(v) !== tipoTop).map((v) => v.trim()),
				),
			].slice(0, 8)
		: [];

	// Célula nativa (data/número) vs texto: se o valor formatado difere do bruto,
	// a célula tem tipo nativo no Sheets. Muda como o parser deve ler.
	let tipoCelula: PerfilColuna["tipoCelula"] = "indefinido";
	const paresComparaveis = valoresFormatados
		.map((f, i) => [f, valoresBrutos[i]] as const)
		.filter(([f]) => f?.trim())
		.slice(0, 50);
	if (paresComparaveis.length > 0) {
		const diferentes = paresComparaveis.filter(
			([f, b]) => (b ?? "") !== "" && String(b) !== String(f),
		).length;
		tipoCelula =
			diferentes > paresComparaveis.length / 2 ? "data/número nativa" : "texto";
	}

	const alertas: string[] = [];
	if (!cabecalho.trim()) alertas.push("CABEÇALHO VAZIO — coluna não mapeável por nome");
	if (preenchidos.length === 0) alertas.push("coluna inteiramente vazia");
	if (naoConformes.length > 0)
		alertas.push(`${naoConformes.length} valor(es) fora do tipo dominante`);

	// Verificação dirigida: coluna que parece coordenação.
	const intersecao = distintos.filter((v) =>
		COORDENACOES_PADRAO.includes(v.toUpperCase()),
	);
	if (intersecao.length >= 2) {
		const fora = distintos.filter(
			(v) => !COORDENACOES_PADRAO.includes(v.toUpperCase()),
		);
		if (fora.length > 0) {
			alertas.push(
				`parece COORDENAÇÃO; ${fora.length} valor(es) fora do padrão seriam convertidos em "CCE" pelo parser atual (sheets.ts:89): ${fora.slice(0, 6).map((v) => `"${v}"`).join(", ")}`,
			);
		}
	}

	return {
		letra: letraColuna(indice),
		indice,
		cabecalho: cabecalho.trim(),
		cabecalhoNormalizado: normalizar(cabecalho),
		preenchidas: preenchidos.length,
		vazias: valoresFormatados.length - preenchidos.length,
		distintas: distintos.length,
		tipoDominante,
		tipoCelula,
		amostras: preenchidos.slice(0, 3).map((v) => truncar(v.trim(), 40)),
		valoresDistintos:
			distintos.length > 0 && distintos.length <= LIMITE_BAIXA_CARDINALIDADE
				? distintos.map((v) => truncar(v, 30))
				: undefined,
		naoConformes: naoConformes.map((v) => truncar(v, 30)),
		alertas,
	};
}

// ─── Análise de uma aba ───────────────────────────────────────────

interface ResultadoAba {
	aba: string;
	totalLinhas: number;
	linhaCabecalho: number;
	candidatosCabecalho: CandidatoCabecalho[];
	colunas: PerfilColuna[];
	cabecalhosDuplicados: string[];
	linhasCurtas: number;
	larguraMaxima: number;
}

interface GradesAba {
	grade: string[][]; // formatada — o que o parser atual enxerga
	gradeBruta: unknown[][]; // sem formatação — revela tipo nativo de data/número
}

/**
 * Carrega TODAS as abas alvo em 2 requisições, via batchGet.
 *
 * Uma chamada por aba estoura a cota do Sheets (60 leituras/min/usuário) em
 * planilhas grandes — a de 23/24 tem 28 abas. batchGet aceita várias ranges de
 * uma vez, então o custo passa a ser 2 requisições no total, independente de
 * quantas abas forem analisadas.
 */
async function carregarGrades(
	sheets: ReturnType<typeof google.sheets>,
	spreadsheetId: string,
	abas: string[],
): Promise<Map<string, GradesAba>> {
	const ranges = abas.map(rangeAba);

	const [respFmt, respBruta] = await Promise.all([
		sheets.spreadsheets.values.batchGet({
			spreadsheetId,
			ranges,
			valueRenderOption: "FORMATTED_VALUE",
		}),
		sheets.spreadsheets.values.batchGet({
			spreadsheetId,
			ranges,
			valueRenderOption: "UNFORMATTED_VALUE",
		}),
	]);

	// A API devolve valueRanges na mesma ordem das ranges enviadas.
	const fmt = respFmt.data.valueRanges ?? [];
	const bruta = respBruta.data.valueRanges ?? [];

	const mapa = new Map<string, GradesAba>();
	abas.forEach((aba, i) => {
		mapa.set(aba, {
			grade: (fmt[i]?.values as string[][]) ?? [],
			gradeBruta: (bruta[i]?.values as unknown[][]) ?? [],
		});
	});
	return mapa;
}

function analisarAba(aba: string, grades: GradesAba, args: Args): ResultadoAba {
	const { grade, gradeBruta } = grades;

	if (grade.length === 0) {
		return {
			aba,
			totalLinhas: 0,
			linhaCabecalho: 0,
			candidatosCabecalho: [],
			colunas: [],
			cabecalhosDuplicados: [],
			linhasCurtas: 0,
			larguraMaxima: 0,
		};
	}

	const deteccao = detectarCabecalho(grade);
	const linhaCabecalho = args.cabecalho ?? deteccao.escolhida;
	const cabecalhos = grade[linhaCabecalho - 1] ?? [];
	const dados = grade.slice(linhaCabecalho);
	const dadosBrutos = gradeBruta.slice(linhaCabecalho);

	// O Sheets corta células vazias no fim da linha — linhas ficam com
	// comprimentos diferentes. É exatamente o que faz row[18] virar undefined
	// silenciosamente nos parsers por índice.
	const larguraMaxima = Math.max(
		cabecalhos.length,
		...dados.map((l) => l?.length ?? 0),
	);
	const linhasCurtas = dados.filter(
		(l) => (l?.length ?? 0) < cabecalhos.length,
	).length;

	const colunas: PerfilColuna[] = [];
	for (let c = 0; c < larguraMaxima; c++) {
		const valoresFmt = dados.map((l) => (l?.[c] ?? "") as string);
		const valoresBrutos = dadosBrutos.map((l) =>
			l?.[c] === undefined || l?.[c] === null ? "" : String(l[c]),
		);
		colunas.push(
			perfilarColuna(c, (cabecalhos[c] ?? "") as string, valoresFmt, valoresBrutos),
		);
	}

	// Cabeçalhos repetidos quebram o mapeamento por nome — precisam ser
	// desambiguados no registry.
	const vistos = new Map<string, number>();
	for (const col of colunas) {
		if (!col.cabecalhoNormalizado) continue;
		vistos.set(
			col.cabecalhoNormalizado,
			(vistos.get(col.cabecalhoNormalizado) ?? 0) + 1,
		);
	}
	const cabecalhosDuplicados = [...vistos.entries()]
		.filter(([, n]) => n > 1)
		.map(([k, n]) => `${k} (${n}×)`);

	return {
		aba,
		totalLinhas: dados.length,
		linhaCabecalho,
		candidatosCabecalho: deteccao.candidatos,
		colunas,
		cabecalhosDuplicados,
		linhasCurtas,
		larguraMaxima,
	};
}

// ─── Impressão ────────────────────────────────────────────────────

function imprimirDumpBruto(grade: string[][], linhas: number) {
	console.log(`\n  Dump bruto (primeiras ${Math.min(linhas, grade.length)} linhas):`);
	const largura = Math.min(
		12,
		Math.max(...grade.slice(0, linhas).map((l) => l?.length ?? 0), 1),
	);

	const cabecalhoLetras = Array.from({ length: largura }, (_, i) =>
		letraColuna(i).padEnd(18),
	).join("");
	console.log(`    #   ${cabecalhoLetras}`);

	for (let i = 0; i < Math.min(linhas, grade.length); i++) {
		const linha = grade[i] ?? [];
		const celulas = Array.from({ length: largura }, (_, c) =>
			truncar(String(linha[c] ?? ""), 17).padEnd(18),
		).join("");
		console.log(`    ${String(i + 1).padStart(3)} ${celulas}`);
	}
	if ((grade[0]?.length ?? 0) > largura) {
		console.log(`    … (${(grade[0]?.length ?? 0) - largura} coluna(s) além de ${letraColuna(largura - 1)} omitidas do dump)`);
	}
}

function imprimirAba(res: ResultadoAba, grade: string[][], args: Args) {
	console.log(`\n${"═".repeat(78)}`);
	console.log(`ABA: "${res.aba}"`);
	console.log("═".repeat(78));

	if (res.totalLinhas === 0 && res.colunas.length === 0) {
		console.log("  (aba vazia)");
		return;
	}

	imprimirDumpBruto(grade, args.linhas);

	console.log(`\n  Candidatos a linha de cabeçalho:`);
	for (const c of res.candidatosCabecalho) {
		const marca = c.linha === res.linhaCabecalho ? " ←ESCOLHIDA" : "";
		console.log(
			`    linha ${String(c.linha).padStart(2)} · ${String(c.preenchidas).padStart(3)} células · pontos ${String(c.pontos).padStart(6)}${marca}   ${c.amostra}`,
		);
	}
	if (args.cabecalho) {
		console.log(`    (forçada via --cabecalho ${args.cabecalho})`);
	} else {
		console.log(`    Se a escolha estiver errada, rode de novo com --cabecalho <n>.`);
	}

	console.log(
		`\n  ${res.totalLinhas} linha(s) de dado abaixo do cabeçalho · ${res.colunas.length} coluna(s)`,
	);

	if (res.linhasCurtas > 0) {
		console.log(
			`  ⚠ ${res.linhasCurtas} linha(s) mais curtas que o cabeçalho — o Sheets corta células vazias no fim.`,
		);
		console.log(
			`     É por isso que um parser por índice lê undefined em silêncio nas colunas finais.`,
		);
	}
	if (res.cabecalhosDuplicados.length > 0) {
		console.log(
			`  ⚠ Cabeçalhos repetidos (impedem mapeamento por nome): ${res.cabecalhosDuplicados.join(", ")}`,
		);
	}

	console.log(`\n  Colunas:`);
	for (const col of res.colunas) {
		const nome = col.cabecalho || "(sem cabeçalho)";
		console.log(
			`\n    ${col.letra} [${col.indice}] ${nome}`,
		);
		console.log(
			`        normalizado: "${col.cabecalhoNormalizado}"`,
		);
		console.log(
			`        ${col.preenchidas} preenchidas · ${col.vazias} vazias · ${col.distintas} distintas · ${col.tipoDominante} · célula: ${col.tipoCelula}`,
		);
		if (col.amostras.length > 0) {
			console.log(`        amostras: ${col.amostras.map((a) => `"${a}"`).join(", ")}`);
		}
		if (col.valoresDistintos) {
			console.log(
				`        domínio fechado (${col.distintas}): ${col.valoresDistintos.map((v) => `"${v}"`).join(", ")}`,
			);
		}
		if (col.naoConformes.length > 0) {
			console.log(
				`        fora do tipo: ${col.naoConformes.map((v) => `"${v}"`).join(", ")}`,
			);
		}
		for (const alerta of col.alertas) {
			console.log(`        ⚠ ${alerta}`);
		}
	}

	// Esqueleto para colar no registry — o humano renomeia as chaves canônicas.
	console.log(`\n  ── Esqueleto para o registry (renomeie as chaves à esquerda) ──\n`);
	console.log(`    aba: ${JSON.stringify(res.aba)},`);
	console.log(`    colunas: {`);
	for (const col of res.colunas) {
		if (!col.cabecalho) continue;
		const chave = normalizar(col.cabecalho)
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_|_$/g, "");
		console.log(
			`      ${chave}: ${JSON.stringify(col.cabecalho)},`.padEnd(58) +
				` // ${col.letra} · ${col.tipoDominante}`,
		);
	}
	console.log(`    },`);
}

// ─── Execução ─────────────────────────────────────────────────────

async function main() {
	const args = parsearArgs(process.argv.slice(2));
	const sheets = await getSheetsClient();

	console.log("=== Inspeção de planilha (somente leitura) ===");
	console.log(`Planilha: ${args.spreadsheetId}`);

	const meta = await sheets.spreadsheets.get({
		spreadsheetId: args.spreadsheetId,
		fields: "properties.title,sheets.properties",
	});

	console.log(`Título:   ${meta.data.properties?.title ?? "(sem título)"}`);

	const todasAbas = (meta.data.sheets ?? []).map((s) => ({
		titulo: s.properties?.title ?? "",
		linhas: s.properties?.gridProperties?.rowCount ?? 0,
		colunas: s.properties?.gridProperties?.columnCount ?? 0,
		oculta: s.properties?.hidden === true,
	}));

	console.log(`\nAbas encontradas (${todasAbas.length}):`);
	for (const a of todasAbas) {
		console.log(
			`  - "${a.titulo}"  ${a.linhas}×${a.colunas}${a.oculta ? "  [OCULTA]" : ""}`,
		);
	}

	const alvos = args.abas.length > 0 ? args.abas : todasAbas.map((a) => a.titulo);

	const inexistentes = alvos.filter(
		(a) => !todasAbas.some((t) => t.titulo === a),
	);
	if (inexistentes.length > 0) {
		console.log(
			`\n⚠ Aba(s) não encontrada(s) — confira o nome exato acima: ${inexistentes.map((a) => `"${a}"`).join(", ")}`,
		);
	}

	const validas = alvos.filter((a) => todasAbas.some((t) => t.titulo === a));
	const grades = await carregarGrades(sheets, args.spreadsheetId, validas);

	const resultados: ResultadoAba[] = [];

	for (const aba of validas) {
		const g = grades.get(aba) ?? { grade: [], gradeBruta: [] };
		const res = analisarAba(aba, g, args);
		resultados.push(res);
		imprimirAba(res, g.grade, args);
	}

	if (args.json) {
		writeFileSync(
			args.json,
			JSON.stringify(
				{
					spreadsheetId: args.spreadsheetId,
					titulo: meta.data.properties?.title,
					abas: todasAbas,
					analise: resultados,
					geradoEm: new Date().toISOString(),
				},
				null,
				2,
			),
			"utf8",
		);
		console.log(`\nJSON gravado em ${args.json}`);
	}

	console.log(`\n=== Fim ===`);
}

main().catch((err) => {
	const msg = err?.message ?? String(err);
	console.error("\nErro:", msg);

	if (/Quota exceeded/i.test(msg)) {
		console.error(
			"\nO Sheets limita leituras por minuto. Espere ~1 minuto e rode de novo,\n" +
				"de preferência restringindo as abas com --aba para reduzir o volume.",
		);
	}
	if (/not found/i.test(msg)) {
		console.error(
			"\nA API não distingue 'não existe' de 'sem acesso'. Confirme que a planilha\n" +
				"foi compartilhada com GOOGLE_SERVICE_ACCOUNT_EMAIL (Leitor basta).",
		);
	}

	process.exit(1);
});
