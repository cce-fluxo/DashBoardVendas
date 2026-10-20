// scripts/congelar-periodos.ts
//
// Congela as métricas dos períodos já fechados (F7).
//
// A partir daqui o banco tem MEMÓRIA: "o que a gestão 24/25 fechou" passa a ser
// um fato guardado, não uma releitura da planilha de hoje. É também o ponto em
// que o banco deixa de ser descartável — antes disto, limpar e recarregar era
// sempre uma opção; depois, o congelado é dado autoral e não se refaz sozinho.
//
// Idempotente: rodar de novo não cria nada se nada novo fechou.
//
// Uso:
//   npx tsx scripts/congelar-periodos.ts            ← mostra o que faria
//   npx tsx scripts/congelar-periodos.ts --gravar   ← grava

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { buscarVendasDoBanco, buscarMetasDoBanco } from "../src/lib/supabase-vendas";
import {
	congelarPeriodos,
	periodosCongelaveis,
	vendasDoPeriodo,
	MESES_DE_CARENCIA,
} from "../src/lib/snapshots/congelar";
import {
	VERSAO_CALCULO,
	calcularMetricasCongeladas,
} from "../src/lib/snapshots/metricas";

const brl = (v: number) =>
	v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function main() {
	const gravar = process.argv.includes("--gravar");

	for (const v of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
		if (!process.env[v]) throw new Error(`${v} é obrigatório no .env.local`);
	}

	console.log("=== Congelamento de períodos ===\n");
	console.log(`Versão de cálculo: ${VERSAO_CALCULO}`);
	console.log(
		`Carência: ${MESES_DE_CARENCIA} mês(es) cheio(s) — um período só congela ` +
			`quando o mês seguinte ao fim dele acaba.`,
	);
	console.log(gravar ? "Modo: GRAVAR\n" : "Modo: simulação (use --gravar)\n");

	const [vendas, metas] = await Promise.all([
		buscarVendasDoBanco(),
		buscarMetasDoBanco(),
	]);
	console.log(`Fonte: ${vendas.length} venda(s), ${metas.length} meta(s).\n`);

	const elegiveis = periodosCongelaveis();
	console.log(`${elegiveis.length} período(s) elegível(is):\n`);
	for (const p of elegiveis) {
		const vs = vendasDoPeriodo(vendas, p.sel);
		if (vs.length === 0) {
			console.log(`  ${p.rotulo.padEnd(34)} — sem vendas`);
			continue;
		}
		const m = calcularMetricasCongeladas(vs, metas, p.sel);
		console.log(
			`  ${p.rotulo.padEnd(34)} ${brl(m.totalVendido).padStart(16)} · ` +
				`${String(m.numeroDeVendas).padStart(3)} venda(s) · ` +
				`meta ${m.metaDefinida ? brl(m.metaVendas) : "não definida"}`,
		);
	}

	if (!gravar) {
		console.log("\nNada gravado. Rode com --gravar para congelar.");
		return;
	}

	const r = await congelarPeriodos({ vendas, metas });

	console.log(`\n${"═".repeat(64)}`);
	console.log(`  ${r.criados.length} snapshot(s) criado(s)`);
	for (const c of r.criados) {
		console.log(`    ${c.rotulo.padEnd(34)} ${c.hash.slice(0, 12)}…`);
	}
	if (r.jaExistiam.length > 0) {
		console.log(`\n  ${r.jaExistiam.length} já congelado(s) — nada a fazer.`);
	}
	if (r.semDados.length > 0) {
		console.log(
			`\n  ${r.semDados.length} período(s) fechado(s) SEM VENDA, não congelado(s):`,
		);
		for (const s of r.semDados.slice(0, 10)) console.log(`    ${s}`);
		if (r.semDados.length > 10) console.log(`    … e mais ${r.semDados.length - 10}`);
		console.log(
			`    (congelar zero afirmaria "fechou sem vendas"; pode ser que a fonte\n` +
				`     daquele período nunca tenha sido carregada — as duas dão lista vazia)`,
		);
	}
	if (r.erros.length > 0) {
		console.log(`\n  ⚠ ${r.erros.length} erro(s):`);
		for (const e of r.erros) console.log(`    ${e.rotulo}: ${e.motivo}`);
		process.exitCode = 1;
	}
	console.log("═".repeat(64));
}

main().catch((err) => {
	console.error("\nErro fatal:", err?.message ?? err);
	process.exit(1);
});
