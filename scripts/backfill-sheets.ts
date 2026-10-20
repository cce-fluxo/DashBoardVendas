// scripts/backfill-sheets.ts
//
// Carga completa das planilhas oficiais para o Supabase, pelo registry.
//
// Diferença para o cron: o cron sincroniza só a gestão vigente; o backfill varre
// todas as do registry (ou uma escolhida com --gestao).
//
// Uso:
//   npx tsx scripts/backfill-sheets.ts
//   npx tsx scripts/backfill-sheets.ts --gestao 23/24
//   npx tsx scripts/backfill-sheets.ts --simular    ← lê tudo, não grava nada
//   npx tsx scripts/backfill-sheets.ts --limpar     ← APAGA vendas e metas antes
//
// Requer a migration 0002 aplicada: sem ela o banco rejeita metas de 23/24 e não
// há coluna `valor_vendido_real`.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

import { sincronizarSheets, todasAsGestoes } from "../src/lib/sync-sheets";
import { buscarGestao } from "../src/lib/fontes/registry";
import type { Gestao } from "../src/lib/fontes/tipos";
import { sincronizarCobertura } from "../src/lib/ingestao/cobertura";

interface Args {
	gestoes: Gestao[];
	limpar: boolean;
	simular: boolean;
}

function parsearArgs(argv: string[]): Args {
	let gestoes = todasAsGestoes();
	let limpar = false;
	let simular = false;

	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--gestao") gestoes = [buscarGestao(argv[++i])];
		else if (argv[i] === "--limpar") limpar = true;
		else if (argv[i] === "--simular") simular = true;
		else throw new Error(`Argumento desconhecido: ${argv[i]}`);
	}

	return { gestoes, limpar, simular };
}

/**
 * Apaga vendas e metas antes da carga.
 *
 * Necessário quando a definição do dado muda — foi o caso dos ciclos, que
 * deixaram de ser "Q1/Q2/Q3" e passaram a ter id próprio: sem limpar, as linhas
 * antigas ficariam órfãs, com chave que ninguém mais escreve.
 *
 * NÃO toca em `card`/`funil` (Pipefy) — esses são do backfill-pipefy.
 */
async function limparVendasEMetas() {
	const supabase = createClient(
		process.env.SUPABASE_URL!,
		process.env.SUPABASE_SERVICE_ROLE_KEY!,
	);

	console.log("[Backfill] Limpando projeto_vendedor, projeto_vendido e meta...");

	// Ordem importa: projeto_vendedor tem FK para projeto_vendido.
	//
	// O erro de cada delete é conferido. Antes eram três `await` sem checagem —
	// uma limpeza que falhasse deixaria o backfill rodar sobre base suja e
	// reportar sucesso, que é exatamente o modo de falha que este projeto existe
	// para eliminar.
	async function limpar(tabela: string, chave: string) {
		const { error } = await supabase.from(tabela).delete().neq(chave, 0);
		if (error) {
			throw new Error(
				`Falha ao limpar "${tabela}": ${error.message}. ` +
					`Abortando — carregar sobre base suja produziria duplicatas.`,
			);
		}
	}

	await limpar("projeto_vendedor", "id_projeto");
	await limpar("projeto_vendido", "id_projeto");
	await limpar("meta", "id_meta");

	// Conferência: sobrou alguma linha? Delete parcial silencioso já aconteceu.
	const restantes = await supabase
		.from("projeto_vendido")
		.select("*", { count: "exact", head: true });
	if ((restantes.count ?? 0) > 0) {
		throw new Error(
			`Após a limpeza ainda restam ${restantes.count} linha(s) em projeto_vendido. Abortando.`,
		);
	}

	console.log("[Backfill] Tabelas limpas.\n");
}

const fmt = (n: number) => n.toLocaleString("pt-BR");

async function main() {
	const args = parsearArgs(process.argv.slice(2));

	if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
		throw new Error(
			"SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no .env.local",
		);
	}

	console.log("=== Backfill Planilhas → Supabase ===\n");
	console.log(`Gestões: ${args.gestoes.map((g) => g.id).join(", ")}`);
	console.log(`Limpar antes: ${args.limpar ? "SIM" : "não"}\n`);

	if (args.simular && args.limpar) {
		throw new Error("--simular e --limpar são incompatíveis: simulação não escreve.");
	}

	if (args.limpar) await limparVendasEMetas();

	const r = await sincronizarSheets({
		gestoes: args.gestoes,
		simular: args.simular,
		disparadoPor: "backfill",
	});

	for (const g of r.porGestao) {
		console.log(`\n${"─".repeat(64)}`);
		console.log(
			`GESTÃO ${g.gestao}${g.execucao !== null ? `  ·  execução #${g.execucao}` : ""}`,
		);
		console.log("─".repeat(64));
		console.log(
			`  contratos: ${g.contratos.inseridos} gravados · ${g.contratos.erros} erro(s)` +
				(g.contratos.removidos > 0
					? ` · ${g.contratos.removidos} removido(s) por sumir da planilha`
					: ""),
		);
		console.log(
			`  metas:     ${g.metas.inseridos} gravadas · ${g.metas.erros} erro(s)` +
				(g.metas.derivadas > 0
					? ` · ${g.metas.derivadas} derivada(s) dos ciclos`
					: "") +
				(g.metas.removidos > 0
					? ` · ${g.metas.removidos} removida(s) por sumir da planilha`
					: ""),
		);

		if (g.rejeicoes.length > 0) {
			console.log(`\n  ${g.rejeicoes.length} rejeição(ões) — a planilha não deu o dado:`);
			for (const rej of g.rejeicoes.slice(0, 10)) {
				console.log(`    ${rej.origemRef.split("#").slice(-1)[0]}: ${rej.motivo}`);
			}
			if (g.rejeicoes.length > 10) {
				console.log(`    … e mais ${g.rejeicoes.length - 10}`);
			}
		}

		// Avisos e notas são separados de propósito: se ⚠ aparece em toda rodada,
		// as pessoas param de ler — e o aviso que importa passa batido.
		if (g.avisos.length > 0) {
			console.log(`\n  ⚠ Avisos — precisam de atenção:`);
			for (const a of g.avisos) console.log(`    ${a}`);
		}

		if (g.notas.length > 0) {
			console.log(`\n  Notas (rotina, sem ação necessária):`);
			for (const n of g.notas) console.log(`    · ${n}`);
		}
	}

	console.log(`\n${"═".repeat(64)}`);
	console.log(
		`  ${fmt(r.totais.contratos)} contrato(s) · ${fmt(r.totais.metas)} meta(s) · ` +
			`${r.totais.erros} erro(s) · ${r.totais.rejeicoes} rejeição(ões) · ` +
			`${r.totais.removidos} removido(s)`,
	);
	console.log("═".repeat(64));

	// Reafirma o que cada fonte cobre no tempo (declarado em fontes/cobertura.ts).
	const cob = await sincronizarCobertura();
	console.log(
		cob.aviso
			? `
⚠ ${cob.aviso}`
			: `
  Cobertura de fonte: ${cob.gravadas} declaração(ões) registrada(s).`,
	);

	if (r.totais.erros > 0) {
		console.log(
			"\nHouve ERROS de gravação (não confundir com rejeições). Ver o log acima.",
		);
		process.exitCode = 1;
	}
}

main().catch((err) => {
	console.error("\nErro fatal:", err?.message ?? err);
	process.exit(1);
});
