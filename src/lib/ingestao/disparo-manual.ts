// src/lib/ingestao/disparo-manual.ts
//
// Quando o botão "atualizar" pode disparar uma sincronização de verdade.
//
// O BOTÃO NÃO ATUALIZAVA NADA
//
// Ele relia o BANCO. E o banco só muda quando o cron roda — de 30 em 30
// minutos. Quem movia um card no Pipefy e clicava via exatamente o mesmo
// número, sem nada explicando por quê. O botão não estava quebrado: estava
// respondendo a outra pergunta ("o que o banco tem agora?") em vez da que a
// pessoa fazia ("vai lá no Pipefy e me traz o de agora").
//
// POR QUE CABE NUM CLIQUE
//
// A carga completa leva ~40 min. A INCREMENTAL, não — ela varre só as fases não
// terminais e pula card cujo `updated_at` não mudou. Medido em 115 rodadas do
// cron:
//
//     mínimo 2,9s · mediana 3,9s · p90 7,3s · máximo 18,8s
//
// São ~10 requisições ao Pipefy por rodada. Cabe num clique com folga.
//
// DUAS TRAVAS, E AS DUAS MORAM NO BANCO
//
// O dashboard é público e roda em serverless: instâncias diferentes não
// compartilham memória, então trava em variável de módulo não trava nada. As
// duas condições saem de `ingestao_execucao`, que todas as instâncias enxergam.
//
//   1. Já tem uma rodando → não abre a segunda. Duas sincronizações concorrentes
//      escrevem as mesmas linhas e uma delas apaga o histórico que a outra
//      acabou de inserir.
//   2. Acabou de rodar → não repete. Segura tanto o clique nervoso quanto quem
//      resolva chamar o endpoint em laço.

export const COOLDOWN_SEGUNDOS = 60;

/**
 * A partir de quanto tempo uma execução "executando" é considerada morta.
 *
 * Sem isto, uma função que morreu no meio (timeout, deploy) deixaria o botão
 * travado em "já tem uma rodando" para sempre. O teto é generoso perto do p90
 * de 7s — o que passar muito disso não está lento, está morto.
 */
export const PENDURADA_MINUTOS = 5;

export interface ExecucaoResumida {
	status: string;
	iniciado_em: string;
	terminado_em: string | null;
}

export type Decisao =
	| { acao: "sincronizar" }
	| { acao: "em_andamento"; desde: string }
	| { acao: "recente"; concluidaEm: string; faltamSegundos: number };

export function decidirDisparo(
	ultima: ExecucaoResumida | null,
	agora: Date = new Date(),
): Decisao {
	if (!ultima) return { acao: "sincronizar" };

	if (ultima.status === "executando" && !ultima.terminado_em) {
		const minutos =
			(agora.getTime() - new Date(ultima.iniciado_em).getTime()) / 60000;
		// Pendurada não bloqueia: `abrirExecucao` já fecha as antigas antes de
		// abrir a nova, então deixar passar aqui é o que destrava o botão.
		if (minutos < PENDURADA_MINUTOS) {
			return { acao: "em_andamento", desde: ultima.iniciado_em };
		}
		return { acao: "sincronizar" };
	}

	if (!ultima.terminado_em) return { acao: "sincronizar" };

	const segundos =
		(agora.getTime() - new Date(ultima.terminado_em).getTime()) / 1000;

	if (segundos < COOLDOWN_SEGUNDOS) {
		return {
			acao: "recente",
			concluidaEm: ultima.terminado_em,
			faltamSegundos: Math.ceil(COOLDOWN_SEGUNDOS - segundos),
		};
	}

	return { acao: "sincronizar" };
}
