//
// Copyright © 2026 3F Venture
// Licensed under the Eclipse Public License, Version 2.0
//

export type BU = 'Seed' | 'Impulse' | 'Bomma'
export type BommaVariant = 'com SM' | 'sem SM'

export interface OnboardingEntry {
  projetoId: string
  templateId: string
  label: string
}

// ─── SEED ────────────────────────────────────────────────────────────────────

export const SEED_TAREFAS: OnboardingEntry[] = [
  // Seed | 1. Coordenação (projeto: 6a0215ac91e156605a9fed2d)
  { projetoId: '6a0215ac91e156605a9fed2d', templateId: '6a047b19e23f15e9fdd19857', label: 'Breve Apresentação do Cliente para time interno' },
  { projetoId: '6a0215ac91e156605a9fed2d', templateId: '6a047b0fe23f15e9fdd19846', label: 'Handoff (vendas > operação)' },
  { projetoId: '6a0215ac91e156605a9fed2d', templateId: '6a047b21e23f15e9fdd19868', label: 'Estruturação de Tarefas Operacionais no 3F TASKS' },

  // Seed | 2. Performance (projeto: 69fce02121c2dabdabe3d3b7)
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047b76e23f15e9fdd19888', label: 'Configuração de Estrutura Interna do Cliente' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047b8be23f15e9fdd198a5', label: 'Reunião de Onboarding e Briefing Inicial' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047b96e23f15e9fdd198b6', label: 'Montagem de Estratégia de Performance' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047b9ee23f15e9fdd198c7', label: 'Reunião Interna de Revisão e Aprovação de Estratégia' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047ba7e23f15e9fdd198d8', label: 'Reunião de Apresentação de Estratégia' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047bb0e23f15e9fdd198e9', label: 'MicroImpactos' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047bc4e23f15e9fdd19908', label: 'Impactos' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047bd3e23f15e9fdd19925', label: 'Setup de Estrutura de Performance' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047bede23f15e9fdd19945', label: 'Acessos aos ativos digitais do cliente' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047bf5e23f15e9fdd19958', label: 'Montagem de Estratégia de Conteúdo' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047bfce23f15e9fdd19969', label: 'Acessos aos materiais da marca' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047c01e23f15e9fdd1997a', label: 'Ativar Primeiras Campanhas' }
]

// ─── IMPULSE ─────────────────────────────────────────────────────────────────

export const IMPULSE_TAREFAS: OnboardingEntry[] = [
  // Impulse | 1. Coordenação (projeto: 6a033a2f87d4dc88317f2d9a)
  { projetoId: '6a033a2f87d4dc88317f2d9a', templateId: '6a0475a14c8dcb4083ddb09c', label: 'Breve Apresentação do Cliente para time interno' },
  { projetoId: '6a033a2f87d4dc88317f2d9a', templateId: '6a0475b34c8dcb4083ddb0aa', label: 'Handoff (vendas > operação)' },
  { projetoId: '6a033a2f87d4dc88317f2d9a', templateId: '6a0475ba4c8dcb4083ddb0b8', label: 'Estruturação de Tarefas Operacionais no 3F TASKS' },

  // Impulse | 2. Performance (projeto: 6a033a5587d4dc88317f2dbd)
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a047653e8250543d0eac607', label: 'Configuração de Estrutura Interna do Cliente' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a047667e8250543d0eac621', label: 'Reunião de Onboarding e Briefing Inicial' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a04766fe8250543d0eac62f', label: 'Montagem de Estratégia de Performance' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a047672e8250543d0eac63d', label: 'Reunião Interna de Revisão e Aprovação de Estratégia' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a04767be8250543d0eac64b', label: 'Reunião de Apresentação de Estratégia' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a04767fe8250543d0eac659', label: 'MicroImpactos' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a047695e8250543d0eac675', label: 'Impactos' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a0476a0e8250543d0eac68e', label: 'Setup de Estrutura de Performance' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a0476c2e8250543d0eac6ab', label: 'Acessos aos ativos digitais do cliente' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a0476c6e8250543d0eac6b9', label: 'Montagem de Estratégia de Conteúdo' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a0476c9e8250543d0eac6c7', label: 'Acessos aos materiais da marca' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a0476d9e8250543d0eac6e3', label: 'Ativar Primeiras Campanhas' }
]

// ─── BOMMA ───────────────────────────────────────────────────────────────────

export const BOMMA_BASE: OnboardingEntry[] = [
  // Bomma | 1. Sucesso do Cliente - tarefas base (projeto: 6a037491cec98c57fca9e4d2)
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a0386cb9d1b435cda0e8532', label: 'Reunião de Onboarding | Boas-Vindas + Planejamento' },
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a0386e29d1b435cda0e854e', label: 'Reunião de Estratégia' },
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a0386b79d1b435cda0e8517', label: 'Onboarding' },

  // Bomma | 2. Performance (projeto: 6a0374a9cec98c57fca9e4ef)
  { projetoId: '6a0374a9cec98c57fca9e4ef', templateId: '6a0387999d1b435cda0e8676', label: 'Ativar Primeira Campanha de Leads' },
  { projetoId: '6a0374a9cec98c57fca9e4ef', templateId: '6a0387889d1b435cda0e865c', label: 'Ativar Primeira Campanha de Aumento de Base' },
  { projetoId: '6a0374a9cec98c57fca9e4ef', templateId: '6a03874c9d1b435cda0e8620', label: 'Setup de Estrutura de Performance' },
  { projetoId: '6a0374a9cec98c57fca9e4ef', templateId: '6a0387729d1b435cda0e8640', label: 'Encontro 03 - Geração de Oportunidades' },

  // Bomma | 3. Social Media (projeto: 6a037558cec98c57fca9e5ca)
  { projetoId: '6a037558cec98c57fca9e5ca', templateId: '6a0479aee23f15e9fdd19557', label: 'Onboarding' },

  // Bomma | 4. Planejamento & Design (projeto: 6a0374bfcec98c57fca9e50e)
  { projetoId: '6a0374bfcec98c57fca9e50e', templateId: '6a0388469d1b435cda0e873d', label: 'Onboarding Semana 02 - Marcar Reunião Inicial de Conteúdo' },
  { projetoId: '6a0374bfcec98c57fca9e50e', templateId: '6a0388579d1b435cda0e8757', label: 'Semana 01 do mês 02 | Encontro de 1º Cronograma' }
]

export const BOMMA_COM_SM: OnboardingEntry[] = [
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a0381e89d1b435cda0e72ca', label: 'Cenário 01 e 02 com Social Media' },
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a0385a79d1b435cda0e84d0', label: 'Cenário 03 com Social Media' }
]

export const BOMMA_SEM_SM: OnboardingEntry[] = [
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a0384c89d1b435cda0e844b', label: 'Cenário 01 e 02 sem Social Media' },
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a0385289d1b435cda0e84a6', label: 'Cenário 03 sem Social Media' }
]

export function getTarefasBomma (variant: BommaVariant): OnboardingEntry[] {
  return [...BOMMA_BASE, ...(variant === 'com SM' ? BOMMA_COM_SM : BOMMA_SEM_SM)]
}

export function getTarefas (bu: BU, bommaVariant?: BommaVariant): OnboardingEntry[] {
  if (bu === 'Seed') return SEED_TAREFAS
  if (bu === 'Impulse') return IMPULSE_TAREFAS
  return getTarefasBomma(bommaVariant ?? 'com SM')
}
