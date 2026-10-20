// src/lib/ingestao/cobertura.ts
//
// Grava no banco o que cada fonte cobre no tempo (declarado em
// src/lib/fontes/cobertura.ts).
//
// Separado do módulo de declaração de propósito: aquele é lido pela UI e não
// pode arrastar o cliente do Supabase para o bundle do navegador.
//
// Idempotente: sempre sobrescreve com o declarado. A declaração no código é a
// autoridade; a tabela é a cópia consultável dela.

import { createClient } from "@supabase/supabase-js";

import { COBERTURAS } from "@/lib/fontes/cobertura";

export interface ResultadoCobertura {
	gravadas: number;
	/** Preenchido quando a tabela não existe ou a escrita falha. */
	aviso?: string;
}

export async function sincronizarCobertura(): Promise<ResultadoCobertura> {
	const supabase = createClient(
		process.env.SUPABASE_URL!,
		process.env.SUPABASE_SERVICE_ROLE_KEY!,
	);

	const linhas = COBERTURAS.map((c) => ({
		fonte_tipo: c.fonteTipo,
		fonte_ref: c.fonteRef,
		gestao: c.gestao,
		inicio_real: c.inicioISO,
		fim_real: c.fimISO,
		observacao: c.observacao,
	}));

	// A chave inclui `gestao`, que é NULL nas coberturas de pipe. Só funciona
	// porque a 0005 recriou a UNIQUE com NULLS NOT DISTINCT — com o padrão do
	// Postgres, este upsert inseriria duas linhas novas a cada carga sem erro
	// nenhum. Ver o comentário da migration.
	const { error } = await supabase
		.from("cobertura_fonte")
		.upsert(linhas, { onConflict: "fonte_tipo,fonte_ref,gestao" });

	if (error) {
		// Não derruba a carga: a cobertura é metadado, e o dado em si já está
		// gravado. Mas o silêncio aqui devolveria o problema que a tabela existe
		// para resolver, então o aviso sobe.
		//
		// SEM CHUTAR A CAUSA. A versão anterior sugeria "aplicou a migration
		// 0004?" em qualquer falha, e numa queda de rede mandava procurar
		// migration faltando — palpite errado atrapalha mais que ausência de
		// palpite. A dica só sai quando o erro é de fato de relação ausente.
		const tabelaAusente = /relation .* does not exist|schema cache/i.test(
			error.message,
		);
		return {
			gravadas: 0,
			aviso:
				`Cobertura de fonte não registrada: ${error.message}.` +
				(tabelaAusente
					? ` A tabela não existe — aplique supabase/migrations/0004_multi_pipe_e_fuso.sql.`
					: ` Sem ela, o dash não distingue "não houve" de "não foi medido".`),
		};
	}

	return { gravadas: linhas.length };
}
