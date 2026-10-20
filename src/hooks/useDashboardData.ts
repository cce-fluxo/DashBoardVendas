'use client'

import { useState, useEffect, useCallback } from 'react'
import { DashboardData, PeriodoGestao, PeriodoCiclo, Coordenacao } from '@/types'
import { selecaoPadrao } from '@/lib/periodos-disponiveis'

type TipoPeriodo = 'gestao' | 'ciclo' | 'mes'

interface FiltrosPeriodo {
  tipo: TipoPeriodo
  gestao: PeriodoGestao
  ciclo?: PeriodoCiclo
  mes?: string
}

interface UseDashboardDataReturn {
  data: DashboardData | null
  loading: boolean
  error: string | null
  filtros: FiltrosPeriodo
  setFiltros: (filtros: Partial<FiltrosPeriodo>) => void
  refetch: () => void
  /** Vai à FONTE (Pipefy) e depois recarrega. É o que o botão de atualizar faz. */
  atualizarAgora: () => Promise<void>
  atualizando: boolean
  /** O que aconteceu no último clique — some sozinho. */
  avisoAtualizacao: string | null
  coordenacoesAtivas: Coordenacao[]
  toggleCoordenacao: (coord: Coordenacao) => void
}

// Uma fonte só de default, derivada da data. Havia '25/26' fixo aqui e em
// ComparadorFunilPeriodos — em 01/10/2026 os dois passariam a apontar para a
// gestão errada, cada um por conta própria.
const FILTROS_PADRAO: FiltrosPeriodo = selecaoPadrao()

const TODAS_COORDS: Coordenacao[] = ['CCE', 'ACE', 'MNP', 'QAB', 'PRO']

export function useDashboardData(): UseDashboardDataReturn {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtros, setFiltrosState] = useState<FiltrosPeriodo>(FILTROS_PADRAO)
  const [coordenacoesAtivas, setCoordenacoesAtivas] = useState<Coordenacao[]>(TODAS_COORDS)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        tipo: filtros.tipo,
        gestao: filtros.gestao,
        ...(filtros.ciclo && { ciclo: filtros.ciclo }),
        ...(filtros.mes && { mes: filtros.mes }),
      })

      // Sem `next: { revalidate: 300 }`: em componente de cliente a opção é
      // ignorada pelo navegador, então ela nunca cacheou nada — mas dizia que
      // cacheava, e era o primeiro lugar onde se procurava explicação para o
      // botão "não atualizar". A causa era outra (ver disparo-manual.ts).
      const response = await fetch(`/api/dashboard?${params}`, {
        cache: 'no-store',
      })

      if (!response.ok) {
        const erro = await response.json()
        throw new Error(erro.message ?? 'Erro ao buscar dados do dashboard')
      }

      const json: DashboardData = await response.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setLoading(false)
    }
  }, [filtros])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca de dados ao montar e ao trocar filtro. A saída é uma lib de data fetching (SWR/React Query), não um ajuste local.
    fetchData()
  }, [fetchData])

  const [atualizando, setAtualizando] = useState(false)
  const [avisoAtualizacao, setAviso] = useState<string | null>(null)

  const atualizarAgora = useCallback(async () => {
    setAtualizando(true)
    setAviso(null)
    try {
      const r = await fetch('/api/dashboard/atualizar', { method: 'POST' })
      const j = await r.json()

      if (j.estado === 'recente') {
        // Não é falha: o dado tem menos de um minuto. Dizer isso é melhor do que
        // fingir que sincronizou — foi a ausência dessa frase que fez o botão
        // parecer quebrado.
        setAviso('Já atualizado agora há pouco')
      } else if (j.estado === 'em_andamento') {
        setAviso('Já tem uma atualização em andamento')
      } else if (j.estado === 'erro' || !r.ok) {
        setAviso('Não foi possível atualizar')
      } else {
        // Rodou, mas nem tudo entrou. Silenciar isto seria mostrar número
        // incompleto como se fosse completo. As duas fontes contam.
        const erros = (j.pipefy?.erros ?? 0) + (j.planilha?.erros ?? 0)
        const rejeitadas = j.planilha?.rejeicoes ?? 0
        if (erros > 0) setAviso(`Atualizado — ${erros} linha(s) com erro`)
        else if (rejeitadas > 0)
          setAviso(`Atualizado — ${rejeitadas} linha(s) da planilha recusada(s)`)
        else setAviso('Atualizado')
      }
    } catch {
      setAviso('Não foi possível atualizar')
    } finally {
      // Recarrega SEMPRE — inclusive quando não sincronizou. Outra aba, ou o
      // cron, pode ter trazido novidade desde a última leitura.
      await fetchData()
      setAtualizando(false)
    }
  }, [fetchData])

  useEffect(() => {
    if (!avisoAtualizacao) return
    const t = setTimeout(() => setAviso(null), 6000)
    return () => clearTimeout(t)
  }, [avisoAtualizacao])

  function setFiltros(novosFiltros: Partial<FiltrosPeriodo>) {
    setFiltrosState(prev => {
      const atualizado = { ...prev, ...novosFiltros }
      if (novosFiltros.tipo === 'gestao') {
        delete atualizado.ciclo
        delete atualizado.mes
      }
      if (novosFiltros.tipo === 'ciclo') delete atualizado.mes
      if (novosFiltros.tipo === 'mes') delete atualizado.ciclo
      return atualizado
    })
  }

  function toggleCoordenacao(coord: Coordenacao) {
    setCoordenacoesAtivas(prev => {
      // Garante que pelo menos uma coordenação fica ativa
      if (prev.includes(coord) && prev.length === 1) return prev
      return prev.includes(coord)
        ? prev.filter(c => c !== coord)
        : [...prev, coord]
    })
  }

  return {
    data,
    loading,
    error,
    filtros,
    setFiltros,
    refetch: fetchData,
    atualizarAgora,
    atualizando,
    avisoAtualizacao,
    coordenacoesAtivas,
    toggleCoordenacao,
  }
}