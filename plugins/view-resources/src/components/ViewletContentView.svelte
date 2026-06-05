<script lang="ts">
  import core, { Class, Doc, DocumentQuery, Ref, Space, WithLookup } from '@hcengineering/core'
  import { IntlString } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { AnySvelteComponent, Component, Loading } from '@hcengineering/ui'
  import view, { BuildModelKey, ViewOptions, Viewlet, ViewletPreference, ViewletProjectDefault } from '@hcengineering/view'
  import { viewletProjectConfigStore } from '../viewletProjectConfig'

  export let viewlet: WithLookup<Viewlet>
  export let _class: Ref<Class<Doc>>
  export let query: DocumentQuery<Doc> = {}
  export let space: Ref<Space> | undefined

  export let viewOptions: ViewOptions

  export let createItemDialog: AnySvelteComponent | undefined = undefined
  export let createItemLabel: IntlString | undefined = undefined
  export let createItemEvent: string | undefined = undefined
  export let createItemDialogProps = { shouldSaveDraft: true }
  export let allowedMixins: Set<string> | undefined = undefined
  // 3F — Quando definido, a resolução de colunas usa 3 camadas (localStorage > ViewletProjectDefault > ViewletPreference).
  // Quando undefined, mantém o comportamento atual (só ViewletPreference workspace).
  export let projectScope: Ref<Space> | undefined = undefined

  const hierarchy = getClient().getHierarchy()

  // 3F — Filtra colunas cuja chave referencia um Mixin que não pertence ao SpaceType
  // do projeto atual. ViewletPreference é workspace-wide; sem isso, custom fields
  // habilitados em um projeto vazariam para outros como "Não selecionado".
  function filterConfigByAllowedMixins (
    config: Array<string | BuildModelKey>,
    allowed: Set<string> | undefined
  ): Array<string | BuildModelKey> {
    if (allowed === undefined) return config
    return config.filter((c) => {
      const key = typeof c === 'string' ? c : (c.key ?? c.displayProps?.key ?? '')
      if (key === '') return true
      if (key.startsWith('$lookup') || key.startsWith('$relation') || key.startsWith('$associations')) return true
      const dot = key.indexOf('.')
      if (dot <= 0) return true
      const head = key.slice(0, dot) as Ref<Class<Doc>>
      if (!hierarchy.hasClass(head) || !hierarchy.isMixin(head)) return true
      return allowed.has(head)
    })
  }

  const preferenceQuery = createQuery()
  const objectConfigurations = createQuery()
  const projectDefaultsQuery = createQuery()
  let preference: ViewletPreference[] = []
  let projectDefaults: ViewletProjectDefault[] = []

  let configurationsLoading = true
  let preferencesLoading = true
  let projectDefaultsLoading = false
  $: loading = configurationsLoading || preferencesLoading || projectDefaultsLoading

  let configurationRaw: Viewlet[] = []
  let configurations: Record<Ref<Class<Doc>>, Viewlet['config']> = {}

  function fetchConfigurations (viewlet: Viewlet): void {
    configurations = {}
    configurationsLoading = objectConfigurations.query(
      view.class.Viewlet,
      {
        attachTo: { $in: hierarchy.getDescendants(_class) },
        descriptor: viewlet.descriptor,
        variant: viewlet.variant ? viewlet.variant : { $exists: false }
      },
      (res) => {
        configurationRaw = res
        configurationsLoading = false
        loading = configurationsLoading || preferencesLoading
      }
    )
  }

  function fetchPreferences (configurationRaw: Viewlet[]): void {
    preferencesLoading = preferenceQuery.query(
      view.class.ViewletPreference,
      {
        space: core.space.Workspace,
        attachedTo: { $in: configurationRaw.map((it) => it._id) }
      },
      (res) => {
        preference = res
        preferencesLoading = false
        loading = configurationsLoading || preferencesLoading || projectDefaultsLoading
      }
    )
  }

  // 3F — Camada intermediária: defaults definidos por Maintainer+ via "Set as project default".
  function fetchProjectDefaults (configurationRaw: Viewlet[], scope: Ref<Space> | undefined): void {
    if (scope === undefined || configurationRaw.length === 0) {
      projectDefaultsQuery.unsubscribe()
      projectDefaults = []
      projectDefaultsLoading = false
      return
    }
    projectDefaultsLoading = projectDefaultsQuery.query(
      view.class.ViewletProjectDefault,
      {
        project: scope,
        viewlet: { $in: configurationRaw.map((it) => it._id) }
      },
      (res) => {
        projectDefaults = res
        projectDefaultsLoading = false
        loading = configurationsLoading || preferencesLoading || projectDefaultsLoading
      }
    )
  }

  // 3F — Resolve a camada vencedora para um viewlet:
  //   - Em projeto:    localStorage > ViewletProjectDefault > undefined (cai pro base config)
  //     Pula ViewletPreference workspace: senão preferências antigas (ex: ordem com Priority
  //     no fim) vazam para projetos via "Restore defaults". O project default cobre o caso
  //     legítimo de "config compartilhada".
  //   - Fora de projeto: ViewletPreference workspace > undefined (base config)
  function resolveEffectiveConfig (
    vl: Viewlet,
    preference: ViewletPreference[],
    projectDefaults: ViewletProjectDefault[],
    localOverrides: Map<string, Array<string | BuildModelKey>>,
    scope: Ref<Space> | undefined
  ): Array<string | BuildModelKey> | undefined {
    if (scope !== undefined) {
      const localCfg = localOverrides.get(`viewletConfig:${vl._id}:${scope}`)
      if (localCfg !== undefined) return localCfg
      const projDefault = projectDefaults.find((d) => d.viewlet === vl._id)
      if (projDefault !== undefined) return projDefault.config
      return undefined
    }
    const ws = preference.find((p) => p.attachedTo === vl._id)
    if (ws !== undefined) return ws.config
    return undefined
  }

  function updateConfiguration (
    configurationRaw: Viewlet[],
    preference: ViewletPreference[],
    projectDefaults: ViewletProjectDefault[],
    localOverrides: Map<string, Array<string | BuildModelKey>>,
    scope: Ref<Space> | undefined,
    allowedMixins: Set<string> | undefined
  ): void {
    const newConfigurations: Record<Ref<Class<Doc>>, Viewlet['config']> = {}

    for (const v of configurationRaw) {
      newConfigurations[v.attachTo] = filterConfigByAllowedMixins(v.config, allowedMixins)
    }

    // Aplica a camada vencedora (localStorage > ViewletProjectDefault > ViewletPreference) por viewlet.
    for (const v of configurationRaw) {
      const cfg = resolveEffectiveConfig(v, preference, projectDefaults, localOverrides, scope)
      if (cfg !== undefined && cfg.length > 0) {
        newConfigurations[v.attachTo] = filterConfigByAllowedMixins(
          mergePreferenceConfig(cfg, v.config),
          allowedMixins
        )
      }
    }

    configurations = newConfigurations
  }

  $: fetchConfigurations(viewlet)
  $: fetchPreferences(configurationRaw)
  $: fetchProjectDefaults(configurationRaw, projectScope)

  $: updateConfiguration(configurationRaw, preference, projectDefaults, $viewletProjectConfigStore, projectScope, allowedMixins)

  // 3F — Mescla config salva pelo usuário com o config base do viewlet.
  // O gear menu não persiste `presenter`/`props`, então preferências salvas antes
  // de mudanças no viewlet base podem quebrar (ex: labels sem LabelsPresenter).
  // Estratégia: a preferência manda em ordem/inclusão/displayProps; o viewlet
  // base completa presenter/props/sortingKey que faltarem, identificando por
  // displayProps.key ou pela chave nua.
  function mergePreferenceConfig (
    prefConfig: Array<string | BuildModelKey>,
    baseConfig: Array<string | BuildModelKey>
  ): Array<string | BuildModelKey> {
    const baseByKey = new Map<string, BuildModelKey>()
    for (const b of baseConfig) {
      if (typeof b === 'string') continue
      const k = b.displayProps?.key ?? b.key
      if (k != null && k !== '') baseByKey.set(k, b)
    }
    return prefConfig.map((p) => {
      if (typeof p === 'string') {
        const base = baseByKey.get(p)
        if (base !== undefined) return { ...base }
        return p
      }
      const k = p.displayProps?.key ?? p.key
      const base = k != null ? baseByKey.get(k) : undefined
      if (base === undefined) return p
      return {
        ...p,
        presenter: p.presenter ?? base.presenter,
        props: p.props ?? base.props,
        label: p.label ?? base.label,
        sortingKey: p.sortingKey ?? base.sortingKey
      }
    })
  }

  $: config = (() => {
    const effective = resolveEffectiveConfig(
      viewlet,
      preference,
      projectDefaults,
      $viewletProjectConfigStore,
      projectScope
    )
    const base = effective === undefined ? viewlet.config : mergePreferenceConfig(effective, viewlet.config)
    return filterConfigByAllowedMixins(base, allowedMixins)
  })()
</script>

{#if viewlet?.$lookup?.descriptor?.component}
  {#if loading}
    <Loading />
  {:else}
    <Component
      is={viewlet.$lookup.descriptor.component}
      props={{
        _class,
        config,
        configurations,
        options: viewlet.options,
        createItemDialog,
        createItemDialogProps,
        createItemLabel,
        createItemEvent,
        viewlet,
        viewOptions,
        viewOptionsConfig: viewlet.viewOptions?.other,
        space,
        query
      }}
    />
  {/if}
{/if}
