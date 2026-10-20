// scripts/comparar-com-linha-de-base.ts
//
// Compara o que o banco produz AGORA com o anexo capturado antes das mudanças
// (anexos/linha-de-base-*.md|json). Somente leitura.
//
// É o critério de aceite da F3: toda diferença tem que ser explicada por uma das
// três mudanças previstas, e nenhuma outra.
//
//   1. ciclos de 24/25 deixaram de ser trimestres calendário
//   2. valor de referência passou de "Valor contrato" para "Valor Vendido real"
//   3. base do funil (ainda não aplicada — é da F6)
//
// Uso:
//   npx tsx scripts/comparar-com-linha-de-base.ts
//   npx tsx scripts/comparar-com-linha-de-base.ts --anexo anexos/linha-de-base-2026-08-01.json

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { buscarVendasDoBanco } from "../src/lib/supabase-vendas";
import { porGestao, porMes, porCiclo } from "../src/lib/calculations";
import { buscarGestao, idsDeGestao } from "../src/lib/fontes/registry";
import { rotuloCiclo } from "../src/lib/periodo-gestao";
import type { Venda } from "../src/types";

const fmt = (n: number) =>
	n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function anexoMaisRecente(): string {
	const dir = "anexos";
	const arquivos = readdirSync(dir)
		.filter((f) => f.startsWith("linha-de-base-") && f.endsWith(".json"))
		.sort();
	if (arquivos.length === 0) {
		throw new Error(
			"Nenhum anexo em anexos/. Rode scripts/capturar-linha-de-base.ts primeiro.",
		);
	}
	return join(dir, arquivos[arquivos.length - 1]);
}

/** Total e contagem de uma lista de vendas, pelo valor de referência atual. */
function totais(vendas: Venda[]) {
	return {
		total: vendas.reduce((s, v) => s + v.valorVendidoReal, 0),
		n: vendas.length,
	};
}

interface Amostra {
	rotulo: string;
	ok: boolean;
	dados?: { vendas?: { totalVendido: number; numeroDeVendas: number } };
}

function main2(anexo: string, vendas: Venda[]) {
	const bruto = JSON.parse(readFileSync(anexo, "utf8"));
	const amostras: Amostra[] = bruto.amostras ?? [];

	const antesDe = (rotulo: string) => {
		const a = amostras.find((x) => x.rotulo === rotulo && x.ok);
		return a?.dados?.vendas;
	};

	console.log(`=== Banco AGORA × linha de base ===\n`);
	console.log(`Anexo: ${anexo}`);
	console.log(`Capturado em: ${bruto.capturadoEm}\n`);

	// ── Gestão e meses: comparáveis, só o valor de referência mudou ──
	console.log("═".repeat(76));
	console.log("COMPARÁVEL — só o valor de referência mudou");
	console.log("═".repeat(76));
	console.log(
		`\n${"Período".padEnd(26)}${"antes".padStart(15)}${"agora".padStart(15)}${"delta".padStart(15)}  n`,
	);

	const MESES = ["10","11","12","01","02","03","04","05","06","07","08","09"];

	for (const gid of ["24/25", "25/26"]) {
		if (!idsDeGestao().includes(gid)) continue;
		const daGestao = porGestao(vendas, gid);

		const linha = (rotulo: string, chaveAnexo: string, lista: Venda[]) => {
			const t = totais(lista);
			const antes = antesDe(chaveAnexo);
			if (!antes) {
				console.log(
					`${rotulo.padEnd(26)}${"—".padStart(15)}${fmt(t.total).padStart(15)}${"(novo)".padStart(15)}  ${t.n}`,
				);
				return;
			}
			const delta = t.total - antes.totalVendido;
			const marca = Math.abs(delta) < 0.005 ? "" : delta > 0 ? " ↑" : " ↓";
			const dn = t.n - antes.numeroDeVendas;
			console.log(
				`${rotulo.padEnd(26)}${fmt(antes.totalVendido).padStart(15)}${fmt(t.total).padStart(15)}${(fmt(delta) + marca).padStart(15)}  ${t.n}${dn !== 0 ? ` (${dn > 0 ? "+" : ""}${dn})` : ""}`,
			);
		};

		console.log("");
		linha(`${gid} · gestão`, `${gid} · gestão inteira`, daGestao);
		for (const m of MESES) {
			linha(`${gid} · mês ${m}`, `${gid} · mês ${m}`, porMes(daGestao, m));
		}
	}

	// ── Ciclos: NÃO comparáveis, a definição mudou ──
	console.log(`\n${"═".repeat(76)}`);
	console.log("NÃO COMPARÁVEL — a definição de ciclo mudou (é a correção)");
	console.log("═".repeat(76));

	for (const gid of ["24/25", "25/26"]) {
		if (!idsDeGestao().includes(gid)) continue;
		const g = buscarGestao(gid);
		const daGestao = porGestao(vendas, gid);
		console.log("");
		let soma = 0;
		for (const c of g.ciclos) {
			const t = totais(porCiclo(daGestao, c.id, gid));
			soma += t.total;
			console.log(
				`  ${rotuloCiclo(c.id, gid).padEnd(46)}${fmt(t.total).padStart(15)}  ${t.n}`,
			);
		}
		const tg = totais(daGestao);
		const fecha = Math.abs(soma - tg.total) < 0.01;
		console.log(
			`  ${"soma dos ciclos".padEnd(46)}${fmt(soma).padStart(15)}` +
				`  ${fecha ? "✓ igual ao total da gestão" : "⚠ NÃO fecha com a gestão"}`,
		);
	}

	console.log(`\n${"═".repeat(76)}`);
	console.log(
		"Esperado: nos meses e na gestão, o delta é só a troca para Valor Vendido",
	);
	console.log(
		"real. Qualquer outra diferença precisa de explicação antes de mergear.",
	);
	console.log("═".repeat(76));
}

async function main() {
	const i = process.argv.indexOf("--anexo");
	const anexo = i >= 0 ? process.argv[i + 1] : anexoMaisRecente();

	const vendas = await buscarVendasDoBanco();
	if (vendas.length === 0) {
		throw new Error(
			"O banco não devolveu venda nenhuma. Rode o backfill antes de comparar.",
		);
	}
	console.log(`${vendas.length} venda(s) lidas do banco.\n`);

	main2(anexo, vendas);
}

main().catch((err) => {
	console.error("\nErro:", err?.message ?? err);
	process.exit(1);
});
