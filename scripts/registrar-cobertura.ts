// scripts/registrar-cobertura.ts
//
// Escreve no banco o que cada fonte cobre no tempo (src/lib/fontes/cobertura.ts).
//
// Os dois backfills já fazem isso ao final. Este script existe para o caso em
// que a DECLARAÇÃO muda sem que os dados mudem — um pipe novo entra, uma janela
// é corrigida — e recarregar 2842 cards por meia hora para atualizar cinco
// linhas de metadado seria absurdo.
//
// Idempotente: sempre sobrescreve com o declarado no código.
//
// Uso:
//   npx tsx scripts/registrar-cobertura.ts

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { COBERTURAS } from "../src/lib/fontes/cobertura";
import { sincronizarCobertura } from "../src/lib/ingestao/cobertura";

async function main() {
	for (const v of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
		if (!process.env[v]) throw new Error(`${v} é obrigatório no .env.local`);
	}

	console.log("=== Cobertura de fonte ===\n");
	for (const c of COBERTURAS) {
		const fim = c.fimISO ? c.fimISO.slice(0, 10) : "aberto";
		console.log(
			`  ${c.fonteTipo.padEnd(8)} ${c.fonteRef.padEnd(46)} ` +
				`${c.gestao ?? "toda gestão"}  ${c.inicioISO.slice(0, 10)} → ${fim}`,
		);
	}

	const r = await sincronizarCobertura();
	if (r.aviso) {
		console.log(`\n⚠ ${r.aviso}`);
		process.exitCode = 1;
		return;
	}
	console.log(`\n  ${r.gravadas} declaração(ões) registrada(s).`);
}

main().catch((err) => {
	console.error("\nErro fatal:", err?.message ?? err);
	process.exit(1);
});
