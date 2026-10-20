'use client'

import { Skeleton } from '@/components/ui/skeleton'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LabelList,
  Cell,
  type LabelProps,
  type TooltipContentProps,
} from 'recharts'
import { SERIES } from '@/lib/colors'

// ─── Tipos ───────────────────────────────────────────────────────

interface DadoVendedor {
  responsavel: string
  totalVendido: number
  numeroDeVendas: number
  ticketMedio: number
}

interface SalesBySellerProps {
  dados: DadoVendedor[]
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

function primeiroNome(nome: string) {
  return nome.split(' ')[0]
}

// ─── Tooltip customizado ──────────────────────────────────────────

function TooltipCustom({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload as DadoVendedor
  return (
    <div className="bg-popover border border-foreground/10 rounded-lg px-3 py-2 text-xs">
      <p className="text-foreground/50 mb-1">{d.responsavel}</p>
      <p className="text-foreground font-semibold">{formatarReais(d.totalVendido)}</p>
      <p className="text-foreground/40">{d.numeroDeVendas} projeto{d.numeroDeVendas !== 1 ? 's' : ''}</p>
      <p className="text-foreground/40">Ticket médio: {formatarReais(d.ticketMedio)}</p>
    </div>
  )
}

// ─── Label customizado (valor ao lado da barra) ───────────────────

function LabelValor({ x, y, width, height, value }: LabelProps) {
  return (
    <text
      x={Number(x) + Number(width) + 8}
      y={Number(y) + Number(height) / 2}
      fill="var(--muted-foreground)"
      fontSize={10}
      dominantBaseline="middle"
    >
      {formatarReais(Number(value))}
    </text>
  )
}

// ─── Skeleton ────────────────────────────────────────────────────

function SellerSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-3 w-20 bg-foreground/10 shrink-0" />
          <Skeleton className="h-5 bg-foreground/10 rounded" style={{ width: `${75 - i * 15}%` }} />
        </div>
      ))}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────

export function SalesBySeller({ dados, loading = false }: SalesBySellerProps) {
  if (loading) return <SellerSkeleton />

  if (!dados?.length) {
    return (
      <div className="flex items-center justify-center h-48 border border-dashed border-foreground/10 rounded-xl">
        <p className="text-sm text-foreground/40">Sem dados para o período selecionado</p>
      </div>
    )
  }

  const ordenados = [...dados].sort((a, b) => b.totalVendido - a.totalVendido)

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, ordenados.length * 56)}>
      <BarChart
        data={ordenados}
        layout="vertical"
        margin={{ top: 0, right: 90, left: 0, bottom: 0 }}
        barCategoryGap="30%"
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="responsavel"
          width={70}
          tickFormatter={primeiroNome}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          content={<TooltipCustom />}
          cursor={{ fill: 'var(--muted)' }}
        />
        <Bar
          dataKey="totalVendido"
          radius={[0, 4, 4, 0]}
          maxBarSize={16}
        >
          {ordenados.map((_, index) => (
            <Cell
              key={index}
              fill={SERIES[index % SERIES.length]}
            />
          ))}
          <LabelList dataKey="totalVendido" content={<LabelValor />} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}