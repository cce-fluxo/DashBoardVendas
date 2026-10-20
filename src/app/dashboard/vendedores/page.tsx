'use client'

import { useState } from 'react'
import { useDashboardData } from '@/hooks/useDashboardData'
import { Sidebar } from '@/components/dashboard/Sidebar'
import { IdadeDoDado } from "@/components/dashboard/IdadeDoDado";
import { ThemeToggle } from '@/components/dashboard/ThemeToggle'
import { PeriodSelector } from '@/components/dashboard/PeriodSelector'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { RefreshCw, Menu } from 'lucide-react'
import { DashboardData, Coordenacao } from '@/types'
import { Logo } from "@/components/dashboard/Logo";
import { descricaoPeriodo } from '@/lib/periodos-disponiveis'

// ─── Utilitários ─────────────────────────────────────────────────

function formatarReais(valor: number) {
  return valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  })
}


// ─── Filtro de dados por coordenações ativas ──────────────────────

function filtrarPorCoordenacoes(
	data: DashboardData,
	coordenacoesAtivas: Coordenacao[],
): DashboardData {
	const coords = new Set(coordenacoesAtivas);

	const porCoordenacao = data.porCoordenacao.filter((c) =>
		coords.has(c.coordenacao),
	);
	const totalVendido = porCoordenacao.reduce(
		(acc, c) => acc + c.totalVendido,
		0,
	);
	const numeroDeVendas = porCoordenacao.reduce(
		(acc, c) => acc + c.numeroDeVendas,
		0,
	);
	const ticketMedio = numeroDeVendas > 0 ? totalVendido / numeroDeVendas : 0;

	return {
		...data,
		porCoordenacao,
		porVendedor: data.porVendedor, // vendedores mantidos — filtro por coord vem do Pipefy
		porCanal: data.porCanal, // canal não tem coord ainda
		vendas: {
			...data.vendas,
			totalVendido,
			numeroDeVendas,
			ticketMedio,
			percentualMeta:
				data.vendas.metaVendas > 0
					? (totalVendido / data.vendas.metaVendas) * 100
					: 0,
			gapMeta: data.vendas.metaVendas - totalVendido,
			// Ao filtrar coordenações, invalidamos a variação global (pois não temos os dados filtrados da gestão passada no client)
			variacaoVsGestaoAnterior: undefined,
		},
	};
}

// ─── Componentes internos ─────────────────────────────────────────

function SecaoTitulo({ titulo, subtitulo }: { titulo: string; subtitulo?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
      {subtitulo && <p className="text-xs text-foreground/40">{subtitulo}</p>}
    </div>
  )
}

function RankBadge({ posicao }: { posicao: number }) {
  const estilos: Record<number, string> = {
    1: 'bg-amber-400/20 text-amber-400 border-amber-400/30',
    2: 'bg-slate-400/20 text-slate-300 border-slate-400/30',
    3: 'bg-orange-700/20 text-orange-400 border-orange-700/30',
  }
  return (
    <div className={`
      w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
      border shrink-0
      ${estilos[posicao] ?? 'bg-foreground/[0.05] text-foreground/30 border-foreground/10'}
    `}>
      {posicao}
    </div>
  )
}

function BarraRelativa({ valor, maximo }: { valor: number; maximo: number }) {
  const largura = maximo > 0 ? (valor / maximo) * 100 : 0
  return (
    <div className="flex-1 h-2 rounded-full bg-foreground/[0.06] overflow-hidden">
      <div
        className="h-full rounded-full bg-primary transition-all duration-500"
        style={{ width: `${largura}%` }}
      />
    </div>
  )
}

function CardVendedor({
  posicao,
  responsavel,
  totalVendido,
  numeroDeVendas,
  ticketMedio,
  maximo,
}: {
  posicao: number
  responsavel: string
  totalVendido: number
  numeroDeVendas: number
  ticketMedio: number
  maximo: number
}) {
  return (
    <div className="
      bg-card border border-foreground/[0.08] rounded-xl p-5
      hover:border-foreground/[0.16] transition-all duration-150
      flex flex-col gap-4
    ">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3">
        <RankBadge posicao={posicao} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{responsavel}</p>
          <p className="text-xs text-foreground/40">
            {numeroDeVendas} projeto{numeroDeVendas !== 1 ? 's' : ''} vendido{numeroDeVendas !== 1 ? 's' : ''}
          </p>
        </div>
        <p className="text-base font-semibold text-foreground shrink-0">
          {formatarReais(totalVendido)}
        </p>
      </div>

      {/* Barra relativa ao primeiro colocado */}
      <BarraRelativa valor={totalVendido} maximo={maximo} />

      {/* Métricas */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-[10px] uppercase tracking-wider text-foreground/30">Ticket Médio</p>
          <p className="text-sm font-medium text-foreground">{formatarReais(ticketMedio)}</p>
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-[10px] uppercase tracking-wider text-foreground/30">Participação</p>
          <p className="text-sm font-medium text-foreground">
            {maximo > 0 ? ((totalVendido / maximo) * 100).toFixed(0) : 0}%
          </p>
        </div>
      </div>
    </div>
  )
}

function VendedoresSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-card border border-foreground/[0.08] rounded-xl p-5 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="w-7 h-7 rounded-full bg-foreground/10" />
            <div className="flex-1 flex flex-col gap-2">
              <Skeleton className="h-3 w-32 bg-foreground/10" />
              <Skeleton className="h-2.5 w-20 bg-foreground/[0.06]" />
            </div>
            <Skeleton className="h-4 w-24 bg-foreground/10" />
          </div>
          <Skeleton className="h-2 w-full rounded-full bg-foreground/[0.06]" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-8 bg-foreground/[0.06] rounded" />
            <Skeleton className="h-8 bg-foreground/[0.06] rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Página ───────────────────────────────────────────────────────

export default function VendedoresPage() {
  const {
    data, loading,
    filtros, setFiltros, refetch,
    coordenacoesAtivas, toggleCoordenacao,
  } = useDashboardData()

  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  const periodoAtivo = descricaoPeriodo(
    filtros.tipo, filtros.gestao, filtros.ciclo, filtros.mes
  )

  const dadosFiltrados =
    data && coordenacoesAtivas.length < 5
      ? filtrarPorCoordenacoes(data, coordenacoesAtivas)
      : data;

  const fat = dadosFiltrados?.vendas;
  const vendedores = data?.porVendedor ?? []
  const maximo = vendedores[0]?.totalVendido ?? 1
  
  const totalGeral = fat?.totalVendido ?? 0
  const totalProjetos = fat?.numeroDeVendas ?? 0
  const mediaTicket = fat?.ticketMedio ?? 0

  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* ── Navbar ─────────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-foreground/[0.06] bg-background/95 backdrop-blur-sm">
        <div className="h-16 flex items-center justify-between gap-4 px-4 md:px-6">
          <div className="flex items-center gap-3 w-auto md:w-[220px] shrink-0">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 -ml-2 rounded-lg hover:bg-foreground/[0.06] transition-colors md:hidden"
            >
              <Menu size={20} className="text-foreground/70" />
            </button>
            <div className="flex items-center gap-3">
              <Logo className="rounded-lg object-contain md:w-10 md:h-10" />
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-semibold text-foreground">Fluxo</span>
                <span className="text-[10px] text-primary">Comercial</span>
              </div>
            </div>
          </div>
          <div className="hidden md:flex flex-1 justify-center">
            <PeriodSelector
              tipo={filtros.tipo}
              gestao={filtros.gestao}
              ciclo={filtros.ciclo}
              mes={filtros.mes}
              onChange={setFiltros}
            />
          </div>
          <div className="flex items-center gap-1 md:gap-3 w-auto md:w-[220px] justify-end shrink-0">
            <IdadeDoDado
							ultimaAtualizacao={data?.ultimaAtualizacao}
							fonteMaisAtrasada={data?.fonteMaisAtrasada}
							frescor={data?.frescor}
							dadoVelho={data?.dadoVelho}
						/>
            <ThemeToggle />
            <button
              onClick={refetch}
              disabled={loading}
              className="p-2 rounded-lg hover:bg-foreground/[0.06] transition-colors disabled:opacity-40"
            >
              <RefreshCw size={14} className={`text-foreground/40 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        {/* Segunda linha exclusiva para mobile */}
        <div className="md:hidden px-4 pb-3 flex justify-center border-t border-foreground/[0.04] pt-2">
          <PeriodSelector
            tipo={filtros.tipo}
            gestao={filtros.gestao}
            ciclo={filtros.ciclo}
            mes={filtros.mes}
            onChange={setFiltros}
          />
        </div>
      </header>

      {/* ── Sidebar ────────────────────────────────────────────── */}
      <Sidebar
        coordenacoesAtivas={coordenacoesAtivas}
        onToggleCoordenacao={toggleCoordenacao}
        gestaoAtual={filtros.gestao}
        periodoAtivo={periodoAtivo}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      {/* ── Conteúdo ───────────────────────────────────────────── */}
      <main className="ml-0 md:ml-[220px] mt-[120px] md:mt-16 px-4 md:px-8 py-8 flex flex-col gap-10 max-w-[1400px]">

        {/* Cabeçalho */}
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-foreground">Vendedores</h1>
          <p className="text-xs md:text-sm text-foreground/40 mt-1">
            Performance individual da equipe comercial — gestão {filtros.gestao}
          </p>
        </div>

        {/* Resumo geral */}
        {!loading && vendedores.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: 'Total da equipe', valor: formatarReais(totalGeral) },
              { label: 'Projetos vendidos', valor: String(totalProjetos) },
              { label: 'Ticket médio da equipe', valor: formatarReais(mediaTicket) },
            ].map(({ label, valor }) => (
              <div
                key={label}
                className="bg-card border border-foreground/[0.08] rounded-xl p-5 flex flex-col gap-2"
              >
                <p className="text-[10px] uppercase tracking-widest text-foreground/30">{label}</p>
                <p className="text-xl md:text-2xl font-semibold text-foreground">{valor}</p>
              </div>
            ))}
          </div>
        )}

        <Separator className="bg-foreground/[0.06]" />

        {/* Cards de vendedores */}
        <section className="flex flex-col gap-4">
          <SecaoTitulo
            titulo="Ranking de vendedores"
            subtitulo="Ordenado por volume vendido no período"
          />
          {loading ? (
            <VendedoresSkeleton />
          ) : vendedores.length === 0 ? (
            <div className="flex items-center justify-center h-48 border border-dashed border-foreground/10 rounded-xl">
              <p className="text-sm text-foreground/40">Sem dados para o período selecionado</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {vendedores.map((v, index) => (
                <CardVendedor
                  key={v.responsavel}
                  posicao={index + 1}
                  responsavel={v.responsavel}
                  totalVendido={v.totalVendido}
                  numeroDeVendas={v.numeroDeVendas}
                  ticketMedio={v.ticketMedio}
                  maximo={maximo}
                />
              ))}
            </div>
          )}
        </section>

      </main>

      <footer className="ml-0 md:ml-[220px] border-t border-foreground/[0.04] mt-10">
        <div className="px-4 md:px-8 py-4 flex flex-col md:flex-row items-center justify-between gap-2">
          <p className="text-xs text-foreground/20">Dashboard Comercial Fluxo</p>
          <p className="text-xs text-foreground/20 text-center md:text-right">Uso interno · Diretoria de Marketing e Vendas</p>
        </div>
      </footer>

    </div>
  )
}
