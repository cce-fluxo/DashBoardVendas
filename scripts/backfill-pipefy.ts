// scripts/backfill-pipefy.ts
//
// Carga completa dos pipes do Pipefy para o Supabase.
//
// Diferença para o cron: o cron varre só os pipes ATIVOS; o backfill varre todos,
// incluindo o "CRM Fluxo" encerrado (1608 cards, 18/12/2023 a 27/06/2025).
//
// Este arquivo tinha ~480 linhas com uma cópia inteira da lógica de ingestão e
// das constantes de fase, mantida em sincronia à mão com src/lib/sync-pipefy.ts.
// Agora é um wrapper: toda a lógica vive lá, e os mapas de fase em
// src/lib/fontes/pipes.ts.
//
// Uso:
//   npx tsx scripts/backfill-pipefy.ts
//   npx tsx scripts/backfill-pipefy.ts --pipe 303819426
//   npx tsx scripts/backfill-pipefy.ts --limpar     ← APAGA cards e funil antes

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

import {
	sincronizarPipefy,
	todosOsPipes,
	buscarPipe,
} from "../src/lib/sync-pipefy";
import type { MapaPipe } from "../src/lib/fontes/pipes";
import { sincronizarCobertura } from "../src/lib/ingestao/cobertura";

interface Args {
	pipes: MapaPipe[];
	limpar: boolean;
}

function parsearArgs(argv: string[]): Args {
	let pipes = todosOsPipes();
	let limpar = false;

	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--pipe") pipes = [buscarPipe(argv[++i])];
		else if (argv[i] === "--limpar") limpar = true;
		else throw new Error(`Argumento desconhecido: ${argv[i]}`);
	}

	return { pipes, limpar };
}

/**
 * Apaga cards e histórico antes da carga.
 *
 * Necessário quando a interpretação do dado muda — foi o caso do `pipe_id`, que
 * não existia: sem limpar, os cards antigos ficariam sem procedência e o mapa de
 * fases não teria como ser escolhido para eles.
 *
 * NÃO toca em projeto_vendido/meta (planilhas) — esses são do backfill-sheets.
 */
async function limparCards() {
	const supabase = createClient(
		process.env.SUPABASE_URL!,
		process.env.SUPABASE_SERVICE_ROLE_KEY!,
	);

	console.log("[Backfill] Limpando funil, card_vendedor e card...");

	// Ordem importa: as duas primeiras têm FK para card.
	async function limpar(tabela: string, chave: string) {
		const { error } = await supabase.from(tabela).delete().neq(chave, 0);
		if (error) {
			throw new Error(
				`Falha ao limpar "${tabela}": ${error.message}. ` +
					`Abortando — carregar sobre base suja produziria histórico misturado.`,
			);
		}
	}

	await limpar("funil", "id_funil");
	await limpar("card_vendedor", "id_card");
	await limpar("card", "id_card");

	const restantes = await supabase
		.from("card")
		.select("*", { count: "exact", head: true });
	if ((restantes.count ?? 0) > 0) {
		throw new Error(
			`Após a limpeza ainda restam ${restantes.count} card(s). Abortando.`,
		);
	}

	console.log("[Backfill] Tabelas limpas.\n");
}

async function main() {
	const args = parsearArgs(process.argv.slice(2));

	for (const v of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "PIPEFY_TOKEN"]) {
		if (!process.env[v]) throw new Error(`${v} é obrigatório no .env.local`);
	}

	console.log("=== Backfill Pipefy → Supabase ===\n");
	console.log(
		`Pipes: ${args.pipes.map((p) => `${p.nome} (${p.pipeId})`).join(", ")}`,
	);
	console.log(`Limpar antes: ${args.limpar ? "SIM" : "não"}\n`);

	if (args.limpar) await limparCards();

	const r = await sincronizarPipefy({
		pipes: args.pipes,
		disparadoPor: "backfill",
	});

	for (const p of r.porPipe) {
		console.log(`\n${"─".repeat(64)}`);
		console.log(
			`${p.nome} (${p.pipeId})${p.execucao !== null ? `  ·  execução #${p.execucao}` : ""}`,
		);
		console.log("─".repeat(64));
		console.log(
			`  ${p.inseridos} card(s) gravado(s) · ${p.erros} erro(s)` +
				(p.reconciliados > 0 ? ` · ${p.reconciliados} reconciliado(s)` : ""),
		);

		if (p.rejeicoes.length > 0) {
			console.log(`\n  ${p.rejeicoes.length} rejeição(ões):`);
			for (const rej of p.rejeicoes.slice(0, 10)) {
				console.log(`    ${rej.origemRef}: ${rej.motivo}`);
			}
			if (p.rejeicoes.length > 10) {
				console.log(`    … e mais ${p.rejeicoes.length - 10}`);
			}
		}
	}

	console.log(`\n${"═".repeat(64)}`);
	console.log(
		`  ${r.totais.inseridos} card(s) · ${r.totais.erros} erro(s) · ` +
			`${r.totais.rejeicoes} rejeição(ões)`,
	);
	console.log("═".repeat(64));

	// Reafirma o que cada fonte cobre no tempo. É o que permite a tela dizer
	// "out–dez/2023 não tinha CRM" em vez de mostrar conversão zero sem explicar.
	const cob = await sincronizarCobertura();
	console.log(
		cob.aviso
			? `\n⚠ ${cob.aviso}`
			: `\n  Cobertura de fonte: ${cob.gravadas} declaração(ões) registrada(s).`,
	);

	if (r.totais.erros > 0) process.exitCode = 1;
}

main().catch((err) => {
	console.error("\nErro fatal:", err?.message ?? err);
	process.exit(1);
});
