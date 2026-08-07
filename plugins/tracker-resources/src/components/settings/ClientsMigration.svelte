<!--
// Copyright © 2025 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<!--
  F12 — Nome do cliente via 3F Core: tela de acompanhamento da migração.
  Mostra, sobre as issues-RAIZ: quantas estão vinculadas ao cadastro da Core,
  quantas ainda são texto livre (pendentes) e quantas estão sem cliente; a
  distribuição de tarefas por cliente; e um painel de pendências com vínculo
  em lote (atribui um cliente a todas as tarefas de um mesmo nome livre).
-->
<script lang="ts">
  import { getClient } from '@hcengineering/presentation'
  import tracker, { ClientStage, type Issue } from '@hcengineering/tracker'
  import {
    Button,
    Icon,
    IconAdd,
    Label,
    Spinner,
    SelectPopup,
    eventToHTMLElement,
    showPopup
  } from '@hcengineering/ui'
  import { onMount } from 'svelte'
  import { clientsStore, ensureClients, clientLabel, clientPopupItems, type CoreClient } from '../../clients'

  const client = getClient()

  const STAGES: Array<{ id: ClientStage, label: string, color: string }> = [
    { id: ClientStage.Onboarding, label: 'Onboarding', color: '#3b82f6' },
    { id: ClientStage.Expansion, label: 'Expansão', color: '#10b981' },
    { id: ClientStage.Retention, label: 'Retenção', color: '#f59e0b' },
    { id: ClientStage.Churned, label: 'Churned', color: '#ef4444' }
  ]

  let loading = true
  let roots: Issue[] = []
  const LIMIT = 20000
  let capped = false

  // Busca + paginação client-side (produção tem muitos clientes/pendências).
  const PENDING_PAGE_SIZE = 15
  const CLIENT_PAGE_SIZE = 15
  let pendingQuery = ''
  let clientQuery = ''
  let pendingPage = 0
  let clientPage = 0

  function norm (s: string): string {
    return s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLocaleLowerCase()
      .trim()
  }

  async function load (): Promise<void> {
    loading = true
    await ensureClients()
    const all = await client.findAll(tracker.class.Issue, {}, { limit: LIMIT })
    capped = all.length >= LIMIT
    const noParent = tracker.ids.NoParent
    roots = all.filter((i) => i.attachedTo === undefined || (i.attachedTo as any) === noParent)
    loading = false
  }

  onMount(load)

  $: state = $clientsStore

  interface PerClient {
    id: number
    label: string
    count: number
    stages: Record<string, number>
  }

  interface Agg {
    total: number
    linked: number
    pendingIssues: number
    noClient: number
    perClient: PerClient[]
    pendingByName: Array<{ name: string, count: number }>
  }

  function compute (rows: Issue[], byId: Map<number, CoreClient>): Agg {
    let linked = 0
    let pendingIssues = 0
    let noClient = 0
    const perClient = new Map<number, PerClient>()
    const pendingByName = new Map<string, number>()

    for (const it of rows) {
      const name = ((it as any).clientName ?? '').trim()
      const coreId = (it as any).clientCoreId as number | undefined
      const stage = String((it as any).clientStage ?? ClientStage.Onboarding)

      if (coreId !== undefined) {
        linked++
        let pc = perClient.get(coreId)
        if (pc === undefined) {
          const c = byId.get(coreId)
          pc = { id: coreId, label: c !== undefined ? clientLabel(c) : name.length > 0 ? name : `#${coreId}`, count: 0, stages: {} }
          perClient.set(coreId, pc)
        }
        pc.count++
        pc.stages[stage] = (pc.stages[stage] ?? 0) + 1
      } else if (name.length > 0) {
        pendingIssues++
        pendingByName.set(name, (pendingByName.get(name) ?? 0) + 1)
      } else {
        noClient++
      }
    }

    return {
      total: rows.length,
      linked,
      pendingIssues,
      noClient,
      perClient: Array.from(perClient.values()).sort((a, b) => b.count - a.count),
      pendingByName: Array.from(pendingByName.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
    }
  }

  $: agg = compute(roots, state.byId)
  $: pct = agg.total > 0 ? Math.round((agg.linked / agg.total) * 100) : 0

  // --- Pendências: filtro + paginação ---
  $: pendingFiltered =
    pendingQuery.trim().length === 0
      ? agg.pendingByName
      : agg.pendingByName.filter((p) => norm(p.name).includes(norm(pendingQuery)))
  $: pendingPages = Math.max(1, Math.ceil(pendingFiltered.length / PENDING_PAGE_SIZE))
  $: if (pendingPage > pendingPages - 1) pendingPage = Math.max(0, pendingPages - 1)
  $: pendingStart = pendingPage * PENDING_PAGE_SIZE
  $: pendingSlice = pendingFiltered.slice(pendingStart, pendingStart + PENDING_PAGE_SIZE)

  // --- Por cliente: filtro + paginação ---
  $: clientFiltered =
    clientQuery.trim().length === 0
      ? agg.perClient
      : agg.perClient.filter((c) => norm(c.label).includes(norm(clientQuery)))
  $: clientPages = Math.max(1, Math.ceil(clientFiltered.length / CLIENT_PAGE_SIZE))
  $: if (clientPage > clientPages - 1) clientPage = Math.max(0, clientPages - 1)
  $: clientStart = clientPage * CLIENT_PAGE_SIZE
  $: clientSlice = clientFiltered.slice(clientStart, clientStart + CLIENT_PAGE_SIZE)

  function stageLabel (id: string): string {
    return STAGES.find((s) => s.id === (id as ClientStage))?.label ?? id
  }
  function stageColor (id: string): string {
    return STAGES.find((s) => s.id === (id as ClientStage))?.color ?? '#9ca3af'
  }

  async function linkAll (name: string, event: MouseEvent): Promise<void> {
    if (state.status !== 'ready' || state.clients.length === 0) return
    const items = clientPopupItems(state.clients)
    showPopup(SelectPopup, { value: items, searchable: true, width: 'large' }, eventToHTMLElement(event), (selId: string | null) => {
      if (selId == null) return
      const c = state.byId.get(Number(selId))
      if (c === undefined) return
      void applyLink(name, c)
    })
  }

  async function applyLink (name: string, c: CoreClient): Promise<void> {
    const canonical = clientLabel(c)
    const targets = roots.filter((i) => ((i as any).clientName ?? '').trim() === name && (i as any).clientCoreId === undefined)
    for (const it of targets) {
      await client.updateDoc(tracker.class.Issue, it.space, it._id, {
        clientCoreId: c.id,
        clientName: canonical
      } as any)
    }
    await load()
  }
</script>

<div class="root">
  <div class="header">
    <div class="title"><Label label={tracker.string.ClientsMigration} /></div>
    <Button kind={'regular'} label={undefined} on:click={load} disabled={loading}>
      <svelte:fragment slot="content">Recarregar</svelte:fragment>
    </Button>
  </div>

  {#if state.status === 'error'}
    <div class="banner warn">
      3F Core indisponível ({state.error ?? 'erro'}) — os números abaixo usam o que já está salvo nas
      tarefas; nomes de clientes podem não resolver.
    </div>
  {/if}
  {#if capped}
    <div class="banner warn">Exibindo as primeiras {LIMIT.toLocaleString('pt-BR')} tarefas (limite de segurança).</div>
  {/if}

  {#if loading}
    <div class="center"><Spinner /></div>
  {:else}
    <!-- KPIs -->
    <div class="kpis">
      <div class="kpi">
        <div class="v">{agg.total.toLocaleString('pt-BR')}</div>
        <div class="l">Tarefas-raiz</div>
      </div>
      <div class="kpi">
        <div class="v ok">{agg.linked.toLocaleString('pt-BR')} <span class="pct">({pct}%)</span></div>
        <div class="l">Vinculadas ao cadastro</div>
      </div>
      <div class="kpi">
        <div class="v warn">{agg.pendingIssues.toLocaleString('pt-BR')}</div>
        <div class="l">Pendentes (texto livre)</div>
      </div>
      <div class="kpi">
        <div class="v muted">{agg.noClient.toLocaleString('pt-BR')}</div>
        <div class="l">Sem cliente</div>
      </div>
    </div>

    <div class="progress"><div class="bar" style:width={`${pct}%`} /></div>

    <!-- Pendências -->
    <div class="section-title">
      Pendências — nomes livres não vinculados ({agg.pendingByName.length.toLocaleString('pt-BR')})
    </div>
    {#if agg.pendingByName.length === 0}
      <div class="empty">🎉 Nenhuma pendência: toda tarefa com cliente está vinculada ao cadastro.</div>
    {:else}
      <input
        class="search"
        type="text"
        placeholder="Filtrar nomes…"
        bind:value={pendingQuery}
        on:input={() => (pendingPage = 0)}
      />
      {#if pendingFiltered.length === 0}
        <div class="empty">Nenhum nome corresponde ao filtro “{pendingQuery}”.</div>
      {:else}
        <table>
          <thead>
            <tr><th>Nome (texto livre)</th><th class="num">Tarefas</th><th class="act">Vincular</th></tr>
          </thead>
          <tbody>
            {#each pendingSlice as p}
              <tr>
                <td class="pending-name">{p.name}</td>
                <td class="num">{p.count}</td>
                <td class="act">
                  <Button
                    kind={'ghost'}
                    size={'small'}
                    disabled={state.status !== 'ready'}
                    on:click={(e) => linkAll(p.name, e)}
                  >
                    <svelte:fragment slot="content">
                      <Icon icon={IconAdd} size={'x-small'} /> <span class="ml">a um cliente</span>
                    </svelte:fragment>
                  </Button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if pendingPages > 1}
          <div class="pager">
            <Button kind={'ghost'} size={'small'} disabled={pendingPage <= 0} on:click={() => (pendingPage -= 1)}>
              <svelte:fragment slot="content">‹ Anterior</svelte:fragment>
            </Button>
            <span class="pginfo">
              {(pendingStart + 1).toLocaleString('pt-BR')}–{Math.min(
                pendingStart + PENDING_PAGE_SIZE,
                pendingFiltered.length
              ).toLocaleString('pt-BR')} de {pendingFiltered.length.toLocaleString('pt-BR')}
            </span>
            <Button
              kind={'ghost'}
              size={'small'}
              disabled={pendingPage >= pendingPages - 1}
              on:click={() => (pendingPage += 1)}
            >
              <svelte:fragment slot="content">Próxima ›</svelte:fragment>
            </Button>
          </div>
        {/if}
      {/if}
    {/if}

    <!-- Por cliente -->
    <div class="section-title">Tarefas por cliente ({agg.perClient.length.toLocaleString('pt-BR')})</div>
    {#if agg.perClient.length === 0}
      <div class="empty">Nenhuma tarefa vinculada ainda.</div>
    {:else}
      <input
        class="search"
        type="text"
        placeholder="Filtrar clientes…"
        bind:value={clientQuery}
        on:input={() => (clientPage = 0)}
      />
      {#if clientFiltered.length === 0}
        <div class="empty">Nenhum cliente corresponde ao filtro “{clientQuery}”.</div>
      {:else}
        <table>
          <thead>
            <tr><th>Cliente</th><th class="num">Tarefas</th><th>Etapas</th></tr>
          </thead>
          <tbody>
            {#each clientSlice as pc}
              <tr>
                <td>{pc.label}</td>
                <td class="num">{pc.count}</td>
                <td>
                  <div class="stages">
                    {#each Object.entries(pc.stages) as [sid, n]}
                      <span class="stage-badge" style:background-color={stageColor(sid)}>{stageLabel(sid)} {n}</span>
                    {/each}
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if clientPages > 1}
          <div class="pager">
            <Button kind={'ghost'} size={'small'} disabled={clientPage <= 0} on:click={() => (clientPage -= 1)}>
              <svelte:fragment slot="content">‹ Anterior</svelte:fragment>
            </Button>
            <span class="pginfo">
              {(clientStart + 1).toLocaleString('pt-BR')}–{Math.min(
                clientStart + CLIENT_PAGE_SIZE,
                clientFiltered.length
              ).toLocaleString('pt-BR')} de {clientFiltered.length.toLocaleString('pt-BR')}
            </span>
            <Button
              kind={'ghost'}
              size={'small'}
              disabled={clientPage >= clientPages - 1}
              on:click={() => (clientPage += 1)}
            >
              <svelte:fragment slot="content">Próxima ›</svelte:fragment>
            </Button>
          </div>
        {/if}
      {/if}
    {/if}
  {/if}
</div>

<style lang="scss">
  .root {
    padding: 1.5rem 2rem;
    max-width: 60rem;
    overflow: auto;
    height: 100%;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }
  .title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--theme-caption-color);
  }
  .banner {
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
    font-size: 0.8125rem;
    &.warn {
      background: rgba(245, 158, 11, 0.12);
      color: var(--theme-warning-color, #b45309);
    }
  }
  .center {
    display: flex;
    justify-content: center;
    padding: 3rem;
  }
  .kpis {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }
  .kpi {
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.75rem;
    padding: 0.875rem 1rem;
    .v {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--theme-caption-color);
      &.ok { color: #10b981; }
      &.warn { color: #f59e0b; }
      &.muted { color: var(--theme-dark-color); }
      .pct { font-size: 0.9rem; font-weight: 500; }
    }
    .l {
      font-size: 0.75rem;
      color: var(--theme-dark-color);
      margin-top: 0.25rem;
    }
  }
  .progress {
    height: 8px;
    background: var(--theme-divider-color);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 1.5rem;
    .bar {
      height: 100%;
      background: #10b981;
      transition: width 0.3s ease;
    }
  }
  .section-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--theme-caption-color);
    margin: 1.25rem 0 0.5rem;
  }
  .empty {
    color: var(--theme-dark-color);
    font-size: 0.8125rem;
    padding: 0.5rem 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid var(--theme-divider-color);
    color: var(--theme-content-color);
  }
  th {
    color: var(--theme-dark-color);
    font-weight: 500;
    font-size: 0.75rem;
  }
  .num {
    text-align: right;
    width: 6rem;
    font-variant-numeric: tabular-nums;
  }
  .act {
    text-align: right;
    width: 9rem;
  }
  .ml { margin-left: 0.25rem; }
  .search {
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 0.5rem;
    padding: 0.4rem 0.6rem;
    font-size: 0.8125rem;
    color: var(--theme-content-color);
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    outline: none;
    &:focus { border-color: var(--primary-button-default, #4361ee); }
    &::placeholder { color: var(--theme-dark-color); }
  }
  .pager {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }
  .pginfo {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
    font-variant-numeric: tabular-nums;
  }
  .pending-name {
    font-style: italic;
    color: var(--theme-warning-color, #b45309);
  }
  .stages {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .stage-badge {
    display: inline-flex;
    align-items: center;
    color: white;
    padding: 1px 6px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.6875rem;
  }
</style>
