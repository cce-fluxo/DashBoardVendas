'use client'

import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PeriodoGestao, PeriodoCiclo } from '@/types'
import {
  ciclosDisponiveis,
  gestoesDisponiveis,
  mesesDisponiveis,
  reconciliarSelecao,
  type OpcaoPeriodo,
} from '@/lib/periodos-disponiveis'

// ─── Tipos ───────────────────────────────────────────────────────

interface PeriodSelectorProps {
  tipo: 'gestao' | 'ciclo' | 'mes'
  gestao: PeriodoGestao
  ciclo?: PeriodoCiclo
  mes?: string
  onChange: (filtros: {
    tipo?: 'gestao' | 'ciclo' | 'mes'
    gestao?: PeriodoGestao
    ciclo?: PeriodoCiclo
    mes?: string
  }) => void
  /**
   * Tratamento próprio para o aviso de reconciliação. Opcional: sem ele, o
   * componente já mostra a mensagem embaixo do seletor — a troca de período
   * NUNCA pode ser silenciosa, e depender de cada página lembrar de exibir
   * garantiria que alguma esquecesse.
   */
  onAviso?: (mensagem: string) => void
}

// As listas eram estáticas aqui: quatro ciclos "Q1..Q4", doze meses e duas
// gestões, fixos. Ofereciam o 4º ciclo numa gestão que tem três, e meses que
// ainda não aconteceram. Agora tudo vem do registry — ver
// src/lib/periodos-disponiveis.ts.

const CLASSE_TRIGGER =
  'bg-foreground/[0.05] border-foreground/[0.08] text-foreground/80 ' +
  'text-[10px] md:text-sm h-8 md:h-9 shrink-0 px-2'

const CLASSE_TAB =
  'text-[10px] md:text-xs px-1.5 md:px-3 border border-transparent text-foreground/50 ' +
  'data-[state=active]:bg-primary/20! data-[state=active]:text-primary! ' +
  'data-[state=active]:border-primary/50! data-[state=active]:font-semibold'

/** Item de período, desabilitado e com motivo visível quando não é escolhível. */
function ItemPeriodo({ opcao }: { opcao: OpcaoPeriodo }) {
  const indisponivel = opcao.estado !== 'disponivel'

  return (
    <SelectItem
      key={opcao.valor}
      value={opcao.valor}
      disabled={indisponivel}
      className="text-foreground/80 text-xs md:text-sm"
    >
      <span className={indisponivel ? 'opacity-50' : undefined}>
        {opcao.rotuloCurto}
      </span>
      {/* Ausência é explicada, não só bloqueada. */}
      {opcao.motivo && (
        <span className="ml-2 text-[10px] text-foreground/40">
          {opcao.motivo}
        </span>
      )}
    </SelectItem>
  )
}

// ─── Componente principal ─────────────────────────────────────────

export function PeriodSelector({
  tipo,
  gestao,
  ciclo,
  mes,
  onChange,
  onAviso,
}: PeriodSelectorProps) {
  const [aviso, setAviso] = useState<string | null>(null)

  const gestoes = gestoesDisponiveis()
  const ciclos = ciclosDisponiveis(gestao)
  const meses = mesesDisponiveis(gestao)

  /**
   * Trocar de gestão pode invalidar o período selecionado: os ids de ciclo são
   * próprios de cada gestão ("waterloo" não existe em 25/26). Reconciliamos e
   * avisamos — antes, a troca deixava o seletor num período inexistente.
   */
  function trocarGestao(novaGestao: string) {
    const { selecao, aviso } = reconciliarSelecao(
      { tipo, gestao, ciclo, mes },
      novaGestao,
    )
    setAviso(aviso ?? null)
    if (aviso) onAviso?.(aviso)
    onChange({
      tipo: selecao.tipo,
      gestao: selecao.gestao,
      ciclo: selecao.ciclo,
      mes: selecao.mes,
    })
  }

  /**
   * Ao entrar em "ciclo" ou "mês" sem nada selecionado, escolhe o primeiro
   * período disponível em vez de deixar o seletor vazio.
   */
  function trocarTipo(novoTipo: 'gestao' | 'ciclo' | 'mes') {
    setAviso(null)
    if (novoTipo === 'ciclo' && !ciclos.some((c) => c.valor === ciclo)) {
      const primeiro = ciclos.find((c) => c.estado === 'disponivel')
      onChange({ tipo: 'ciclo', ciclo: primeiro?.valor })
      return
    }
    if (novoTipo === 'mes' && !meses.some((m) => m.valor === mes)) {
      const disponiveis = meses.filter((m) => m.estado === 'disponivel')
      onChange({ tipo: 'mes', mes: disponiveis[disponiveis.length - 1]?.valor })
      return
    }
    onChange({ tipo: novoTipo })
  }

  return (
    <div className="flex flex-col gap-1">
    <div className="flex items-center gap-2 md:gap-3 max-w-full overflow-x-auto no-scrollbar pb-1 md:pb-0">

      {/* Gestão */}
      <Select value={gestao} onValueChange={trocarGestao}>
        <SelectTrigger className={`w-[85px] md:w-36 ${CLASSE_TRIGGER}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-popover border-foreground/[0.08]">
          {gestoes.map((g) => (
            <SelectItem
              key={g.valor}
              value={g.valor}
              className="text-foreground/80 text-xs md:text-sm"
            >
              {g.rotuloCurto}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Tipo de período */}
      <Tabs
        value={tipo}
        onValueChange={(v) => trocarTipo(v as 'gestao' | 'ciclo' | 'mes')}
        className="shrink-0"
      >
        <TabsList className="bg-foreground/[0.05] border border-foreground/[0.08] h-8 md:h-9 p-0.5 md:p-1">
          <TabsTrigger value="gestao" className={CLASSE_TAB}>Gestão</TabsTrigger>
          <TabsTrigger value="ciclo" className={CLASSE_TAB}>Ciclo</TabsTrigger>
          <TabsTrigger value="mes" className={CLASSE_TAB}>Mês</TabsTrigger>
        </TabsList>
      </Tabs>

      {tipo === 'ciclo' && (
        <Select
          value={ciclo ?? ''}
          onValueChange={(v) => onChange({ ciclo: v as PeriodoCiclo })}
        >
          <SelectTrigger className={`w-[130px] md:w-64 ${CLASSE_TRIGGER}`}>
            <SelectValue placeholder="Ciclo" />
          </SelectTrigger>
          <SelectContent className="bg-popover border-foreground/[0.08]">
            {ciclos.map((c) => (
              <ItemPeriodo key={c.valor} opcao={c} />
            ))}
          </SelectContent>
        </Select>
      )}

      {tipo === 'mes' && (
        <Select value={mes ?? ''} onValueChange={(v) => onChange({ mes: v })}>
          <SelectTrigger className={`w-[95px] md:w-36 ${CLASSE_TRIGGER}`}>
            <SelectValue placeholder="Mês" />
          </SelectTrigger>
          <SelectContent className="bg-popover border-foreground/[0.08]">
            {meses.map((m) => (
              <ItemPeriodo key={m.valor} opcao={m} />
            ))}
          </SelectContent>
        </Select>
      )}

    </div>

      {/* A reconciliação evita estado inválido, mas mudar o período do usuário
          sem dizer nada seria só outra forma de esconder o que aconteceu. */}
      {aviso && (
        <p className="text-[10px] md:text-xs text-amber-600 dark:text-amber-400 max-w-[32rem]">
          {aviso}
        </p>
      )}
    </div>
  )
}
