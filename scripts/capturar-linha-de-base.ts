// scripts/capturar-linha-de-base.ts
//
// Captura os números que o dashboard exibe HOJE, antes das mudanças que vão
// alterá-los. Somente leitura — só faz GET nos endpoints públicos do deploy.
//
// POR QUE ISSO EXISTE
//   Três mudanças planejadas alteram valores já em uso:
//     1. ciclos da gestão 24/25 (hoje calculados como trimestres calendário)
//     2. valor de referência passa de "Valor contrato" para "Valor Vendido real"
//     3. base do funil passa de "Contato aberto" para "Oportunidade"
//   O banco vai ser recarregado do zero, então depois NÃO há como reconstruir o
//   "antes". Este anexo é a única forma de responder "por que esse número mudou?".
//
// Uso:
//   npx tsx scripts/capturar-linha-de-base.ts
//   npx tsx scripts/capturar-linha-de-base.ts --url https://... --delay 2000
//
// Flags:
//   --url <base>     Base do deploy (default: produção).
//   --delay <ms>     Espera entre requisições (default 1500).
//   --saida <dir>    Pasta de saída (default: anexos/).
//
// CUIDADO COM A COTA DO SHEETS: /api/dashboard lê o Google Sheets a cada
// requisição (4 chamadas, com cache de 5 min). A varredura é SEQUENCIAL e com
// pausa de propósito — em paralelo, ela derruba o dashboard em produção.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Sem padrão no código: o repositório é público e a URL de produção não pode
// aparecer nele. Passe --url ou defina DASHBOARD_URL no ambiente.
const URL_PADRAO = process.env.DASHBOARD_URL ?? "";
const GESTOES = ["24/25", "25/26"];
const CICLOS = ["Q1", "Q2", "Q3", "Q4"];
const MESES = ["10", "11", "12", "01", "02", "03", "04", "05", "06", "07", "08", "09"];

// ─── Argumentos ───────────────────────────────────────────────────

interface Args {
	url: string;
	delay: number;
	saida: string;
}

function parsearArgs(argv: string[]): Args {
	let url = URL_PADRAO;
	let delay = 1500;
	let saida = "anexos";

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--url") url = argv[++i];
		else if (a === "--delay") delay = parseInt(argv[++i], 10);
		else if (a === "--saida") saida = argv[++i];
		else throw new Error(`Argumento desconhecido: ${a}`);
	}

	if (!url) {
		throw new Error("Informe a URL de produção: --url https://... ou DASHBOARD_URL no ambiente.");
	}
	return { url: url.replace(/\/$/, ""), delay, saida };
}

// ─── Coleta ───────────────────────────────────────────────────────

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Amostra {
	rotulo: string;
	caminho: string;
	ok: boolean;
	erro?: string;
	dados?: any;
}

async function buscar(base: string, caminho: string, rotulo: string): Promise<Amostra> {
	try {
		const resp = await fetch(`${base}${caminho}`, {
			headers: { accept: "application/json" },
		});
		if (!resp.ok) {
			return { rotulo, caminho, ok: false, erro: `HTTP ${resp.status}` };
		}
		return { rotulo, caminho, ok: true, dados: await resp.json() };
	} catch (err) {
		return { rotulo, caminho, ok: false, erro: err instanceof Error ? err.message : String(err) };
	}
}

function alvos(): { rotulo: string; caminho: string }[] {
	const lista: { rotulo: string; caminho: string }[] = [];

	for (const gestao of GESTOES) {
		const g = encodeURIComponent(gestao);

		lista.push({
			rotulo: `${gestao} · gestão inteira`,
			caminho: `/api/dashboard?tipo=gestao&gestao=${g}`,
		});

		for (const ciclo of CICLOS) {
			lista.push({
				rotulo: `${gestao} · ciclo ${ciclo}`,
				caminho: `/api/dashboard?tipo=ciclo&gestao=${g}&ciclo=${ciclo}`,
			});
		}

		for (const mes of MESES) {
			lista.push({
				rotulo: `${gestao} · mês ${mes}`,
				caminho: `/api/dashboard?tipo=mes&gestao=${g}&mes=${mes}`,
			});
		}
	}

	lista.push({ rotulo: "funil (gestão atual)", caminho: "/api/dashboard/funil" });

	return lista;
}

// ─── Resumo legível ───────────────────────────────────────────────

function fmt(n: number | undefined | null): string {
	if (n === undefined || n === null || Number.isNaN(n)) return "—";
	return n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function resumoMarkdown(amostras: Amostra[], args: Args, quando: string): string {
	const linhas: string[] = [];

	linhas.push(`# Linha de base — números do dashboard antes das mudanças`);
	linhas.push("");
	linhas.push(`Capturado em ${quando} de \`${args.url}\`.`);
	linhas.push("");
	linhas.push(
		`Este anexo existe para responder "por que esse número mudou?" depois da`,
	);
	linhas.push(
		`recarga do banco. Três mudanças previstas alteram valores aqui: ciclos da`,
	);
	linhas.push(
		`24/25, troca para \`Valor Vendido real\`, e base do funil em Oportunidade.`,
	);
	linhas.push("");

	const falhas = amostras.filter((a) => !a.ok);
	if (falhas.length > 0) {
		linhas.push(`> ⚠ ${falhas.length} de ${amostras.length} requisições falharam:`);
		for (const f of falhas) linhas.push(`> - ${f.rotulo}: ${f.erro}`);
		linhas.push("");
	}

	// ── Vendas por período ──
	linhas.push(`## Vendas por período`);
	linhas.push("");
	linhas.push(
		`| Período | Total vendido | Nº vendas | Ticket médio | Meta | % meta |`,
	);
	linhas.push(`|---|---:|---:|---:|---:|---:|`);

	for (const a of amostras) {
		if (!a.ok || !a.dados?.vendas) continue;
		const v = a.dados.vendas;
		linhas.push(
			`| ${a.rotulo} | ${fmt(v.totalVendido)} | ${fmt(v.numeroDeVendas)} | ${fmt(v.ticketMedio)} | ${fmt(v.metaVendas)} | ${fmt(v.percentualMeta)} |`,
		);
	}
	linhas.push("");

	// ── Coordenação, só nos períodos de gestão e ciclo ──
	linhas.push(`## Por coordenação (gestão e ciclos)`);
	linhas.push("");
	linhas.push(`| Período | Coord | Total vendido | Nº vendas | Meta |`);
	linhas.push(`|---|---|---:|---:|---:|`);

	for (const a of amostras) {
		if (!a.ok || !Array.isArray(a.dados?.porCoordenacao)) continue;
		if (a.rotulo.includes("· mês")) continue; // reduz ruído
		for (const c of a.dados.porCoordenacao) {
			linhas.push(
				`| ${a.rotulo} | ${c.coordenacao} | ${fmt(c.totalVendido)} | ${fmt(c.numeroDeVendas)} | ${fmt(c.metaVendas)} |`,
			);
		}
	}
	linhas.push("");

	// ── Funil ──
	const funil = amostras.find((a) => a.rotulo.startsWith("funil"));
	if (funil?.ok && funil.dados?.funil?.geral) {
		const geral = funil.dados.funil.geral;
		linhas.push(`## Funil — geral (gestão atual)`);
		linhas.push("");
		linhas.push(
			`Base atual: \`Contato aberto\` = ${fmt(geral.conversao?.totalContatoAberto)} cards (100%).`,
		);
		linhas.push(
			`Depois da mudança, a base passa a ser \`Oportunidade\` — **todos os`,
		);
		linhas.push(`percentuais abaixo vão cair**, porque o denominador cresce.`);
		linhas.push("");
		linhas.push(`| Etapa | Qtd | % acumulado | % etapa anterior |`);
		linhas.push(`|---|---:|---:|---:|`);
		for (const e of geral.conversao?.etapas ?? []) {
			linhas.push(
				`| ${e.etapa} | ${fmt(e.quantidade)} | ${fmt(e.percentualRelativo)} | ${fmt(e.percentualEtapaAnterior)} |`,
			);
		}
		linhas.push("");
		linhas.push(
			`Tempo médio até venda: ${fmt(geral.tempo?.tempoMedioVendaDias)} dias ` +
				`(amostra de ${fmt(geral.tempo?.totalVendas)} vendas). ` +
				`Até qualquer fechamento: ${fmt(geral.tempo?.tempoMedioFechamentoDias)} dias.`,
		);
		linhas.push("");
	}

	linhas.push(`---`);
	linhas.push("");
	linhas.push(
		`O JSON ao lado tem as respostas completas, incluindo vendedor, canal e`,
	);
	linhas.push(`funil por coordenação.`);

	return linhas.join("\n");
}

// ─── Execução ─────────────────────────────────────────────────────

async function main() {
	const args = parsearArgs(process.argv.slice(2));
	const lista = alvos();

	console.log("=== Captura da linha de base (somente leitura) ===\n");
	console.log(`Origem: ${args.url}`);
	console.log(`${lista.length} requisições, sequenciais, ${args.delay}ms entre elas`);
	console.log(
		`(sequencial de propósito: /api/dashboard lê o Sheets a cada request)\n`,
	);

	const amostras: Amostra[] = [];

	for (let i = 0; i < lista.length; i++) {
		const { rotulo, caminho } = lista[i];
		process.stdout.write(
			`  [${String(i + 1).padStart(2)}/${lista.length}] ${rotulo.padEnd(28)}`,
		);

		const amostra = await buscar(args.url, caminho, rotulo);
		amostras.push(amostra);

		console.log(amostra.ok ? "ok" : `FALHOU — ${amostra.erro}`);

		if (i < lista.length - 1) await espera(args.delay);
	}

	const agora = new Date();
	const carimbo = agora.toISOString().slice(0, 10);
	const quando = agora.toISOString();

	mkdirSync(args.saida, { recursive: true });

	const caminhoJson = join(args.saida, `linha-de-base-${carimbo}.json`);
	const caminhoMd = join(args.saida, `linha-de-base-${carimbo}.md`);

	writeFileSync(
		caminhoJson,
		JSON.stringify({ origem: args.url, capturadoEm: quando, amostras }, null, 2),
		"utf8",
	);
	writeFileSync(caminhoMd, resumoMarkdown(amostras, args, quando), "utf8");

	const falhas = amostras.filter((a) => !a.ok).length;

	console.log(`\n${"═".repeat(60)}`);
	console.log(`  ${amostras.length - falhas} ok · ${falhas} falha(s)`);
	console.log(`  ${caminhoJson}`);
	console.log(`  ${caminhoMd}`);
	console.log("═".repeat(60));
	console.log(
		`\nCommitar os dois arquivos — eles são o "antes" e não podem ser refeitos`,
	);
	console.log(`depois da recarga do banco.`);

	if (falhas > 0) process.exitCode = 1;
}

main().catch((err) => {
	console.error("\nErro:", err?.message ?? err);
	process.exit(1);
});
