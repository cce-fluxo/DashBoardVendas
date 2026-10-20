'use client'

import { Skeleton } from '@/components/ui/skeleton'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  type TooltipContentProps,
} from 'recharts'
import { SERIES } from '@/lib/colors'

// ─── Tipos ───────────────────────────────────────────────────────

interface DadoCanal {
  canal: string
  totalVendido: number
  numeroDeVendas: number
}

interface SalesByChannelProps {
  dados: DadoCanal[]
  loading?: boolean
}

// ─── Utilitários ─────────────────────────────────────────────────

function formatarReais(valor: number) {
  return valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  })
}

// ─── Tooltip customizado ──────────────────────────────────────────

function TooltipCustom({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload as DadoCanal
  return (
    <div className="bg-popover border border-foreground/10 rounded-lg px-3 py-2 text-xs">
      <p className="text-foreground/50 mb-1">{d.canal}</p>
      <p className="text-foreground font-semibold">{formatarReais(d.totalVendido)}</p>
      <p className="text-foreground/40">{d.numeroDeVendas} projeto{d.numeroDeVendas !== 1 ? 's' : ''}</p>
    </div>
  )
}

// ─── Skeleton ────────────────────────────────────────────────────

function ChannelSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-3 w-24 bg-foreground/10 shrink-0" />
          <Skeleton className="h-5 bg-foreground/10 rounded" style={{ width: `${80 - i * 12}%` }} />
        </div>
      ))}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────

export function SalesByChannel({ dados, loading = false }: SalesByChannelProps) {
  if (loading) return <ChannelSkeleton />

  if (!dados?.length) {
    return (
      <div className="flex items-center justify-center h-48 border border-dashed border-foreground/10 rounded-xl">
        <p className="text-sm text-foreground/40">Sem dados para o período selecionado</p>
      </div>
    )
  }

  const ordenados = [...dados].sort((a, b) => b.totalVendido - a.totalVendido)
  const maximo = ordenados[0]?.totalVendido ?? 1

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, ordenados.length * 52)}>
      <BarChart
        data={ordenados}
        layout="vertical"
        margin={{ top: 0, right: 80, left: 0, bottom: 0 }}
        barCategoryGap="30%"
      >
        <XAxis
          type="number"
          domain={[0, maximo * 1.1]}
          hide
        />
        <YAxis
          type="category"
          dataKey="canal"
          width={90}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          content={<TooltipCustom />}
          cursor={{ fill: 'var(--muted)' }}
        />
        <Bar dataKey="totalVendido" radius={[0, 4, 4, 0]} maxBarSize={16}>
          {ordenados.map((_, index) => (
            <Cell
            key={index}
            fill={SERIES[index % SERIES.length]}
            fillOpacity={0.9}
          />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}