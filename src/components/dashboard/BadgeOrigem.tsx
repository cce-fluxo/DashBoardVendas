"use client";

import { OrigemDosNumeros } from "@/types";

/**
 * Diz se os números de venda desta tela são o que o período FECHOU ou o que a
 * planilha diz AGORA.
 *
 * Os dois são visualmente idênticos e significam coisas diferentes, e essa é a
 * confusão que a F7 existe para acabar. Antes dela não havia "o que a gestão
 * 24/25 fechou" — havia só "o que a planilha diz hoje sobre 24/25", e corrigir
 * uma linha em 2027 mudava, retroativamente e em silêncio, um número já
 * apresentado em reunião.
 *
 * Período ao vivo NÃO ganha selo: é o estado normal, e um aviso em toda tela
 * vira ruído que ensina a ignorar avisos. Só o congelamento e, principalmente,
 * a divergência precisam aparecer.
 */
export function BadgeOrigem({ origem }: { origem?: OrigemDosNumeros }) {
	if (!origem || origem.tipo !== "congelado") return null;

	const data = origem.congeladoEm
		? new Date(origem.congeladoEm).toLocaleDateString("pt-BR", {
				day: "2-digit",
				month: "2-digit",
				year: "numeric",
				timeZone: "America/Sao_Paulo",
			})
		: null;

	// Hash que não bate significa que o JSON guardado foi alterado por fora — o
	// banco recusa UPDATE nesta tabela. É de outra natureza que "a fonte mudou".
	if (origem.integro === false) {
		return (
			<div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2">
				<p className="text-[11px] leading-relaxed text-red-700 dark:text-red-300">
					<span className="font-semibold">Congelamento corrompido. </span>
					Os números guardados não conferem com a própria assinatura, o que só
					acontece por alteração feita fora do sistema. Não use esta tela para
					decidir nada até alguém verificar o banco.
				</p>
			</div>
		);
	}

	if (origem.divergenteDaFonte) {
		return (
			<div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
				<p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
					<span className="font-semibold">
						Números fechados{data ? ` em ${data}` : ""} — e a planilha mudou
						desde então.{" "}
					</span>
					A tela mostra o que foi fechado, não o que a planilha diz hoje. Se a
					alteração foi uma correção legítima, o período precisa ser
					recongelado de propósito; até lá, o valor apresentado continua sendo o
					que se reportou.
				</p>
			</div>
		);
	}

	return (
		<div className="flex items-center gap-2 flex-wrap">
			<span
				className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/25"
				title={origem.abrangencia}
			>
				números fechados{data ? ` em ${data}` : ""}
			</span>
			{origem.recalculoDisponivel != null && (
				<span
					className="text-[9px] text-foreground/40"
					title={`Existe um recálculo na versão ${origem.recalculoDisponivel}. A tela mostra o original de propósito: correção se anuncia, não se aplica por baixo.`}
				>
					recálculo v{origem.recalculoDisponivel} disponível
				</span>
			)}
		</div>
	);
}
