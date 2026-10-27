// src/lib/fontes/entregas.ts
//
// Lê as abas de projetos ("Projetos - Entregues", "Projetos - Atual") da
// planilha de projetos. Puro (grade em memória): a rede fica em sheets-fonte.ts.
//
// Colunas casadas pelo nome do cabeçalho, com duas exceções observadas na
// planilha em out/2026:
//
// 1. Em "Projetos - Entregues" o cabeçalho "Coordenação" está sobre a coluna A,
//    que é um checkbox; a coordenação mesmo fica na B. Por isso a coordenação é
//    a primeira das quatro primeiras células que for uma das cinco.
// 2. As linhas de ACE têm, a partir de "Data inicial", DUAS colunas a mais que
//    o cabeçalho: em "Gestão - Venda" aparece o valor faturado ("R$ 47.000,00")
//    e a gestão está duas colunas adiante. O deslocamento é detectado por linha,
//    e só quando a célula no lugar da gestão traz outra coisa (vazio e "-" são
//    gestão em branco, não deslocamento). Nessas linhas o "Prazo Real" também
//    está duas colunas adiante, e formatado como moeda: "R$ 46.197,00" é o
//    número de série da data (46197 = 24/06/2026).
//
// A data da entrega é o "Prazo Real" ("Prazo Final" é calculado pela planilha,
// não é quando entregou). Sem ele, "Data de finalização". "Gestão - Entrega"
// é gravada crua, mas a TV não a usa: a fórmula não é confiável, a gestão sai
// da data.

import { normalizarCoordenacao, parsearDataBR, type CoordenacaoValida } from "./mapear";
import { normalizarCabecalho } from "./normalizar";

export type EstadoProjeto = "entregue" | "em_execucao";

export interface ProjetoLido {
	estado: EstadoProjeto;
	coordenacao: CoordenacaoValida;
	projeto: string;
	gestaoVenda: string | null;
	gestaoEntrega: string | null;
	dataEntrega: string | null;
	tamanhoEquipe: number | null;
	/** Gerente e consultores, na ordem da planilha. */
	equipe: string[];
	/** "Prev. Prazo": "Finalizado", "Rescindido", "Dentro do Prazo"... */
	situacao: string | null;
	origemRef: string;
}

export interface ProjetosLidos {
	projetos: ProjetoLido[];
	rejeitadas: { origemRef: string; motivo: string; linha: string[] }[];
	/** Linhas sem projeto (modelo vazio) ou já finalizadas em "Projetos - Atual". */
	ignoradas: number;
	avisos: string[];
}

const GESTAO = /^\d{2}\/\d{2}$/;

export function lerProjetos(
	estado: EstadoProjeto,
	spreadsheetId: string,
	aba: string,
	grade: string[][],
): ProjetosLidos {
	const r: ProjetosLidos = { projetos: [], rejeitadas: [], ignoradas: 0, avisos: [] };
	const cab = (grade[0] ?? []).map((c) => normalizarCabecalho(c ?? ""));
	const col = (nome: string) => cab.indexOf(normalizarCabecalho(nome));
	const c = {
		projeto: col("Projeto"),
		venda: col("Gestão - Venda"),
		entrega: col("Gestão - Entrega"),
		finalizacao: col("Data de finalização"),
		prazoReal: col("Prazo Real"),
		tamanho: col("Tamanho da Equipe"),
		situacao: col("Prev. Prazo"),
		finalizado: col("Finalizado?"),
		// "Gerente" e "Consultor N" se repetem no fim da aba (pesos do pódio):
		// indexOf pega a primeira ocorrência, que é a da equipe.
		pessoas: ["Gerente", ...[1, 2, 3, 4, 5, 6].map((n) => `Consultor ${n}`)].map(col),
	};
	if (c.projeto < 0 || c.venda < 0) {
		r.avisos.push(`aba "${aba}": cabeçalho sem "Projeto" ou "Gestão - Venda"; nada lido.`);
		return r;
	}

	const vistos = new Set<string>();
	grade.slice(1).forEach((linha, i) => {
		const cel = (j: number) => (j < 0 ? "" : (linha[j] ?? "").trim());
		const origemRef = `${spreadsheetId}#${aba}#${i + 2}`;
		const projeto = cel(c.projeto);
		if (!projeto) return void r.ignoradas++;
		if (estado === "em_execucao" && cel(c.finalizado).toUpperCase() === "TRUE") return void r.ignoradas++;

		const coordenacao = linha.slice(0, 4).map(normalizarCoordenacao).find((x) => x !== null) ?? null;
		if (!coordenacao) {
			r.rejeitadas.push({ origemRef, motivo: "coordenação ausente ou inválida", linha });
			return;
		}

		const noLugar = cel(c.venda);
		let desloc = 0;
		if (noLugar && noLugar !== "-" && !GESTAO.test(noLugar)) {
			// Pela gestão da venda; vazia ela, pelo "-" da de entrega duas colunas adiante.
			desloc =
				[1, 2, 3].find((k) => GESTAO.test(cel(c.venda + k))) ??
				[1, 2, 3].find((k) => c.entrega >= 0 && /^(\d{2}\/\d{2}|-)$/.test(cel(c.entrega + k))) ??
				-1;
			if (desloc < 0) {
				r.rejeitadas.push({ origemRef, motivo: `gestão da venda ilegível ("${noLugar}")`, linha });
				return;
			}
		}
		const gestao = (j: number) => (j < 0 || !GESTAO.test(cel(j + desloc)) ? null : cel(j + desloc));

		const real = dataDaCelula(cel(c.prazoReal < 0 ? -1 : c.prazoReal + desloc));
		const fim = dataDaCelula(cel(c.finalizacao));
		const tamanho = parseInt(cel(c.tamanho), 10);

		const chave = `${coordenacao}|${projeto}|${gestao(c.venda)}`;
		if (vistos.has(chave)) {
			r.rejeitadas.push({ origemRef, motivo: `projeto repetido na aba (${projeto}, venda ${gestao(c.venda) ?? "sem gestão"})`, linha });
			return;
		}
		vistos.add(chave);

		r.projetos.push({
			estado,
			coordenacao,
			projeto,
			gestaoVenda: gestao(c.venda),
			gestaoEntrega: estado === "entregue" ? gestao(c.entrega) : null,
			dataEntrega: estado === "entregue" ? (real ?? fim) : null,
			tamanhoEquipe: Number.isFinite(tamanho) && tamanho > 0 ? tamanho : null,
			equipe: [...new Set(c.pessoas.map(cel).filter((n) => n && n !== "-"))],
			situacao: cel(c.situacao) || null,
			origemRef,
		});
	});

	return r;
}

/**
 * Data de uma célula: "24/06/2026" ou o número de série do Sheets formatado
 * como moeda ("R$ 46.197,00", linhas deslocadas). Ano antes de 2000 é duração
 * formatada como data ("20/05/1900" = 141 dias), não data.
 */
function dataDaCelula(bruto: string): string | null {
	const serie = /^R\$\s*(\d{1,3}(?:\.\d{3})*),00$/.exec(bruto);
	if (serie) {
		const n = Number(serie[1].replace(/\./g, ""));
		if (n < 36526) return null; // antes de 01/01/2000: não é data de entrega
		return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10);
	}
	const { data } = parsearDataBR(bruto);
	return data && data >= "2000" ? data : null;
}
