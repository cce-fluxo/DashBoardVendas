// scripts/verificar-registry.ts
//
// Roda o registry contra as planilhas oficiais de verdade (somente leitura) e
// mostra o que ele conseguiu extrair. É a prova de que o mapeamento por
// cabeçalho funciona nas três gestões, cada uma com um layout diferente.
//
// Uso:
//   npx tsx scripts/verificar-registry.ts
//   npx tsx scripts/verificar-registry.ts --gestao 24/25

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { GESTOES, buscarGestao } from "../src/lib/fontes/registry";
import { validarCalendario, mesesDoCiclo } from "../src/lib/fontes/calendario";
import { lerContratos, lerMetasDaGestao } from "../src/lib/fontes/sheets-fonte";
import { letraColuna } from "../src/lib/fontes/normalizar";
import type { CampoContrato, Gestao } from "../src/lib/fontes/tipos";

function parsearArgs(argv: string[]): { gestoes: Gestao[] } {
	const idx = argv.indexOf("--gestao");
	if (idx >= 0) return { gestoes: [buscarGestao(argv[idx + 1])] };
	return { gestoes: GESTOES };
}

function parsearValor(bruto: string): number {
	if (!bruto?.trim()) return 0;
	const limpo = bruto
		.replace(/R\$\s?/g, "")
		.replace(/\./g, "")
		.replace(",", ".")
		.trim();
	return parseFloat(limpo) || 0;
}

const COORDS = ["CCE", "ACE", "MNP", "QAB", "PRO"];

const fmt = (n: number) =>
	n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

async function main() {
	const { gestoes } = parsearArgs(process.argv.slice(2));

	console.log("=== Verificação do registry contra as planilhas reais ===\n");

	console.log("Calendário:");
	validarCalendario(GESTOES);
	console.log("  ✓ válido nas três gestões (contíguo, 12 meses, sem sobreposição)\n");

	for (const g of gestoes) {
		console.log(`${"═".repeat(72)}`);
		console.log(`GESTÃO ${g.id}  ·  ${g.contratos.aba}`);
		console.log("═".repeat(72));

		console.log(`\n  Ciclos (${g.ciclos.length}):`);
		for (const c of g.ciclos) {
			console.log(
				`    ${c.rotulo.padEnd(26)} ${mesesDoCiclo(c).join(", ")}`,
			);
		}

		let tabela;
		try {
			tabela = await lerContratos(g);
		} catch (err) {
			console.log(`\n  ✗ FALHOU: ${err instanceof Error ? err.message : String(err)}\n`);
			process.exitCode = 1;
			continue;
		}

		const campos = Object.entries(tabela.resolucao) as [CampoContrato, number][];
		console.log(`\n  Colunas resolvidas (${campos.length}):`);
		for (const [campo, idx] of campos.sort((a, b) => a[1] - b[1])) {
			console.log(`    ${letraColuna(idx).padEnd(3)} → ${campo}`);
		}

		const declarados = Object.keys(g.contratos.colunas) as CampoContrato[];
		const naoResolvidos = declarados.filter(
			(c) => tabela.resolucao[c] === undefined,
		);
		if (naoResolvidos.length > 0) {
			console.log(`    (opcionais não encontrados: ${naoResolvidos.join(", ")})`);
		}

		console.log(
			`\n  ${tabela.linhas.length} contrato(s) aceito(s) · ` +
				`${tabela.descartadas.length} descartado(s) · ` +
				`${tabela.ignoradas} linha(s) de ruído ignorada(s)`,
		);

		if (tabela.descartadas.length > 0) {
			console.log(
				`\n  ⚠ Descartadas — têm identificador mas falta obrigatório.`,
			);
			console.log(`    Na F5 viram linhas em ingestao_rejeicao:`);
			for (const d of tabela.descartadas.slice(0, 8)) {
				const preenchidos = Object.entries(d.valores)
					.filter(([, v]) => String(v).trim())
					.map(([k, v]) => `${k}="${String(v).slice(0, 24)}"`)
					.join(", ");
				console.log(`      L${d.linhaPlanilha}: ${d.motivo}`);
				console.log(`        tinha: ${preenchidos}`);
			}
			if (tabela.descartadas.length > 8) {
				console.log(`      … e mais ${tabela.descartadas.length - 8}`);
			}
		}

		// Somatórios: é aqui que se vê se o mapeamento pegou a coluna certa.
		const totalVV = tabela.linhas.reduce(
			(s, l) => s + parsearValor(l.valores.valorVendidoReal ?? ""),
			0,
		);
		const totalVC = tabela.linhas.reduce(
			(s, l) => s + parsearValor(l.valores.valorContrato ?? ""),
			0,
		);

		console.log(`    Valor Vendido real: ${fmt(totalVV)}`);
		console.log(`    Valor contrato:     ${fmt(totalVC)}`);
		const dif = totalVV - totalVC;
		console.log(
			`    Diferença:          ${fmt(dif)}` +
				(Math.abs(dif) > 0.005
					? "   ← as duas colunas DIVERGEM (por isso guardamos ambas)"
					: "   (idênticas nesta gestão)"),
		);

		// Coordenação fora do padrão: o parser antigo convertia em "CCE".
		const coordsVistas = new Map<string, number>();
		for (const l of tabela.linhas) {
			const c = (l.valores.coordenacao ?? "").trim().toUpperCase();
			coordsVistas.set(c, (coordsVistas.get(c) ?? 0) + 1);
		}
		const fora = [...coordsVistas.keys()].filter((c) => !COORDS.includes(c));
		console.log(
			`\n  Coordenações: ${[...coordsVistas.entries()]
				.map(([c, n]) => `${c || "(vazia)"}=${n}`)
				.join(", ")}`,
		);
		if (fora.length > 0) {
			console.log(
				`    ⚠ fora do padrão: ${fora.map((c) => `"${c}"`).join(", ")} — o parser antigo as converteria em "CCE"`,
			);
		}

		// Meses distintos, para conferir se a coluna A foi lida certo.
		const meses = new Set(tabela.linhas.map((l) => l.valores.mes ?? ""));
		console.log(`\n  Meses distintos (${meses.size}): ${[...meses].join(", ")}`);

		console.log(`\n  Exemplo de linhagem: ${tabela.linhas[0]?.origemRef ?? "—"}`);

		// ── Metas ──
		const m = await lerMetasDaGestao(g);
		const porTipo = (t: string) => m.metas.filter((x) => x.tipo === t);

		console.log(
			`\n  Metas: ${m.metas.length} lidas · ${m.ilegiveis.length} ilegível(is) · ${m.avisos.length} aviso(s)`,
		);

		const mensais = porTipo("mes");
		const somaMensal = mensais.reduce((s, x) => s + x.valor, 0);
		const gestaoFluxo = porTipo("gestao").find((x) => x.coordenacao === null);
		console.log(
			`    mensais (Fluxo): ${mensais.length}/12 · soma ${fmt(somaMensal)}`,
		);
		console.log(
			`    gestão (Fluxo):  ${gestaoFluxo ? fmt(gestaoFluxo.valor) : "—"}` +
				(gestaoFluxo && Math.abs(gestaoFluxo.valor - somaMensal) < 0.01
					? "   ✓ bate com a soma mensal"
					: ""),
		);

		const gestaoCoords = porTipo("gestao").filter((x) => x.coordenacao !== null);
		console.log(
			`    gestão por coord (${gestaoCoords.some((x) => x.derivada) ? "DERIVADA dos ciclos" : "lida da planilha"}): ` +
				(gestaoCoords.length === 0 ? "—" : gestaoCoords.map((x) => `${x.coordenacao}=${fmt(x.valor)}`).join(", ")),
		);

		for (const c of g.ciclos) {
			const doCiclo = porTipo("ciclo").filter((x) => x.periodo === c.id);
			const fluxo = doCiclo.find((x) => x.coordenacao === null);
			const coords = doCiclo.filter((x) => x.coordenacao !== null);
			const soma = coords.reduce((s, x) => s + x.valor, 0);
			const fecha =
				fluxo && coords.length > 0 && Math.abs(soma - fluxo.valor) < 0.01;
			console.log(
				`    ${c.rotulo.padEnd(26)} Fluxo=${(fluxo ? fmt(fluxo.valor) : "—").padStart(14)} · ${coords.length} coord` +
					(fecha ? " ✓ somam o total" : coords.length ? " ⚠ NÃO somam o total" : ""),
			);
		}

		if (m.ilegiveis.length > 0) {
			console.log(`\n    Ilegíveis (meta ausente ≠ meta zero):`);
			for (const i of m.ilegiveis.slice(0, 8)) {
				console.log(`      ${i.rotulo}: "${i.bruto}" — ${i.motivo}`);
			}
			if (m.ilegiveis.length > 8) {
				console.log(`      … e mais ${m.ilegiveis.length - 8}`);
			}
		}
		if (m.avisos.length > 0) {
			console.log(`\n    Avisos:`);
			for (const a of m.avisos) console.log(`      ⚠ ${a}`);
		}

		if (g.observacoes?.length) {
			console.log(`\n  Observações registradas:`);
			for (const o of g.observacoes) console.log(`    · ${o}`);
		}
		console.log("");
	}

	console.log("=== Fim ===");
}

main().catch((err) => {
	console.error("\nErro:", err?.message ?? err);
	process.exit(1);
});
