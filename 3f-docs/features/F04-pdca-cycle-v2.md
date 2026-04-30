# F04-v2 — PDCA Cycle: Melhorias de Comportamento

## Objetivo

Evoluir o módulo de ciclo PDCA com três novas capacidades:
1. **Zerar tempo gasto** ao reiniciar o ciclo
2. **Data de vencimento automática** configurável por frequência
3. **Modo duplicar** — criar nova issue ao invés de só resetar status

---

## Escopo

### O que muda

| Camada | Arquivo | O que muda |
|---|---|---|
| Modelo | `plugins/tracker/src/index.ts` | +3 campos na interface `Issue` |
| Model class | `models/tracker/src/types.ts` | +3 `@Prop` em `TIssue` |
| Worker | `services/worker/src/pdca.ts` | reset `reportedTime`, calcular `dueDate`, lógica de duplicação |
| UI | `PdcaCycleSection.svelte` | seletor de dia de vencimento + toggle duplicar |
| i18n | `tracker-assets/lang/*.json` | +6 strings |

---

## Novos campos no modelo

```ts
// plugins/tracker/src/index.ts — dentro de interface Issue
pdcaCycleDueDays?: number[]    // dia(s) configurado(s) para o vencimento
pdcaCycleDuplicate?: boolean   // se true: duplica ao invés de resetar
```

### Semântica de `pdcaCycleDueDays`

| Frequência | Conteúdo do array | Exemplo |
|---|---|---|
| `weekly` | 1 elemento: índice do dia da semana (0=Dom, 1=Seg … 6=Sab) | `[5]` = sexta |
| `biweekly` | 2 elementos: dias do mês | `[1, 15]` = dia 1 e dia 15 |
| `monthly` | 1 elemento: dia do mês (1–31) | `[15]` = dia 15 |

---

## Lógica do worker (`pdca.ts`)

### 1. Zerar tempo gasto

No `client.update` do reset, adicionar `reportedTime: 0`:

```ts
await client.update(issue, { status: resetStatus, reportedTime: 0 })
```

### 2. Calcular data de vencimento

```ts
function calculateDueDate(
  frequency: PdcaFrequency,
  dueDays: number[] | undefined
): number | null {
  if (!dueDays || dueDays.length === 0) return null
  const now = new Date()

  if (frequency === 'weekly') {
    const targetWeekday = dueDays[0]           // 0–6
    const currentDay = now.getDay()
    let daysUntil = (targetWeekday - currentDay + 7) % 7
    if (daysUntil === 0) daysUntil = 7         // não hoje, próxima semana
    const due = new Date(now)
    due.setDate(now.getDate() + daysUntil)
    due.setHours(23, 59, 0, 0)
    return due.getTime()
  }

  if (frequency === 'monthly') {
    const targetDay = dueDays[0]               // 1–31
    const due = new Date(now.getFullYear(), now.getMonth(), targetDay, 23, 59)
    if (due.getTime() <= now.getTime()) {
      due.setMonth(due.getMonth() + 1)
    }
    return due.getTime()
  }

  if (frequency === 'biweekly') {
    const sorted = [...dueDays].sort((a, b) => a - b)  // ex: [1, 15]
    const todayDay = now.getDate()
    const nextDay = sorted.find(d => d > todayDay) ?? sorted[0]
    const due = new Date(now.getFullYear(), now.getMonth(), nextDay, 23, 59)
    if (due.getTime() <= now.getTime()) {
      due.setMonth(due.getMonth() + 1)
      due.setDate(sorted[0])
    }
    return due.getTime()
  }

  return null
}
```

Setar `dueDate` no update:

```ts
const dueDate = calculateDueDate(frequency, (issue as any).pdcaCycleDueDays)

await client.update(issue, {
  status: resetStatus,
  reportedTime: 0,
  ...(dueDate != null ? { dueDate } : {})
})
```

### 3. Modo duplicar

Quando `pdcaCycleDuplicate === true`:

```ts
if ((issue as any).pdcaCycleDuplicate === true) {
  // 1. Criar nova issue como cópia
  await client.addCollection(
    tracker.class.Issue,
    issue.space,
    issue.attachedTo ?? issue.space,
    issue.attachedToClass ?? tracker.class.Project,
    'issues',
    {
      title: issue.title,
      status: resetStatus,
      kind: issue.kind,
      assignee: issue.assignee,
      priority: issue.priority,
      component: issue.component,
      milestone: issue.milestone,
      estimation: issue.estimation,
      reportedTime: 0,
      dueDate: dueDate ?? null,
      pdcaCycleActive: true,
      pdcaCycleFrequency: frequency,
      pdcaCycleResetStatus: resetStatus,
      pdcaCycleDueDays: (issue as any).pdcaCycleDueDays,
      pdcaCycleDuplicate: true,
      clientName: (issue as any).clientName,
      clientStage: (issue as any).clientStage,
    }
  )

  // 2. Marcar a issue original como concluída (status Won)
  const wonStatus = await client.findOne(tracker.class.IssueStatus, {
    _id: { $in: (await client.findAll(tracker.class.IssueStatus, { space: issue.space }))
      .filter(s => s.category === 'task:category:Won')
      .map(s => s._id)
    }
  })
  if (wonStatus != null) {
    await client.update(issue, {
      status: wonStatus._id,
      pdcaCycleActive: false   // para de gerar novos ciclos na original
    })
  }

} else {
  // Modo padrão: só reset de status
  await client.update(issue, {
    status: resetStatus,
    reportedTime: 0,
    ...(dueDate != null ? { dueDate } : {})
  })
}
```

**Nota:** ao criar a issue duplicada, o agendamento do próximo ciclo passa a ser feito em cima da nova issue. A original fica arquivada com PDCA desativado.

---

## UI — `PdcaCycleSection.svelte`

### Novas rows no `.pdca-body` (abaixo de "Status ao reiniciar")

#### Linha: Data de vencimento (condicional por frequência)

```svelte
<!-- Semanal → dia da semana -->
{#if selectedFrequency === PdcaFrequency.Weekly}
  <div class="pdca-row">
    <span class="pdca-label"><Label label={tracker.string.PdcaDueWeekday} /></span>
    <DropdownLabelsIntl
      kind="link-bordered"
      size="small"
      items={weekdayItems}
      selected={issue.pdcaCycleDueDays?.[0] ?? -1}
      disabled={readonly}
      on:selected={(e) => { void setDueDays([e.detail]) }}
    />
  </div>
{/if}

<!-- Quinzenal → dois dias do mês -->
{#if selectedFrequency === PdcaFrequency.Biweekly}
  <div class="pdca-row">
    <span class="pdca-label"><Label label={tracker.string.PdcaDueMonthDays} /></span>
    <div class="pdca-two-days">
      <input type="number" min="1" max="31" value={issue.pdcaCycleDueDays?.[0] ?? ''} ... />
      <span>e</span>
      <input type="number" min="1" max="31" value={issue.pdcaCycleDueDays?.[1] ?? ''} ... />
    </div>
  </div>
{/if}

<!-- Mensal → dia do mês -->
{#if selectedFrequency === PdcaFrequency.Monthly}
  <div class="pdca-row">
    <span class="pdca-label"><Label label={tracker.string.PdcaDueMonthDay} /></span>
    <input type="number" min="1" max="31" value={issue.pdcaCycleDueDays?.[0] ?? ''} ... />
  </div>
{/if}
```

`weekdayItems` é um array estático de `DropdownIntlItem` com as strings `PdcaWeekdayMon` … `PdcaWeekdaySun`.

#### Linha: Modo duplicar

```svelte
<div class="pdca-row">
  <span class="pdca-label"><Label label={tracker.string.PdcaDuplicate} /></span>
  <Toggle
    on={issue.pdcaCycleDuplicate === true}
    disabled={readonly}
    on:change={(e) => { void setDuplicate(e.detail) }}
  />
</div>
```

---

## Strings i18n (pt-br.json e demais)

```json
"PdcaDueWeekday": "Vencimento (dia da semana)",
"PdcaDueMonthDay": "Vencimento (dia do mês)",
"PdcaDueMonthDays": "Vencimento (dias do mês)",
"PdcaDuplicate": "Duplicar ao reiniciar",
"PdcaWeekdayMon": "Segunda-feira",
"PdcaWeekdayTue": "Terça-feira",
"PdcaWeekdayWed": "Quarta-feira",
"PdcaWeekdayThu": "Quinta-feira",
"PdcaWeekdayFri": "Sexta-feira",
"PdcaWeekdaySat": "Sábado",
"PdcaWeekdaySun": "Domingo"
```

*(en.json usa os nomes em inglês; os outros 10 arquivos ficam com o fallback em inglês ou traduzido conforme necessário)*

---

## Ordem de implementação

1. **Modelo** — adicionar os 2 campos em `index.ts` + `types.ts`
2. **i18n** — adicionar as 11 strings nos 12 arquivos de lang
3. **Worker** — `reportedTime: 0` + `calculateDueDate()` + lógica de duplicação
4. **UI** — seletores de dia + toggle duplicar em `PdcaCycleSection.svelte`
5. **Commit + push** — um commit único cobrindo todas as camadas

---

## Complexidade estimada

| Item | Esforço |
|---|---|
| Zerar tempo gasto | Trivial (1 linha no worker) |
| Data de vencimento (cálculo) | Baixo |
| Data de vencimento (UI) | Médio (3 layouts condicionais) |
| Modo duplicar (worker) | Médio |
| Modo duplicar (UI) | Trivial (1 toggle) |
| **Total** | ~2–3h de implementação |

---

## Riscos

- `addCollection` no worker usa `TxOperations` — precisa que `attachedToClass` esteja correto para sub-issues. Testar com issue de nível raiz primeiro.
- Inputs `<input type="number">` precisam de debounce para não disparar update a cada tecla.
- `dueDate` de issues duplicadas substitui o `dueDate` original se já existir — comportamento esperado.
