<script lang="ts">
  import core, { Class, Doc, DocumentQuery, Ref, Space, WithLookup } from '@hcengineering/core'
  import { IntlString } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { AnySvelteComponent, Component, Loading } from '@hcengineering/ui'
  import view, { BuildModelKey, ViewOptions, Viewlet, ViewletPreference } from '@hcengineering/view'

  export let viewlet: WithLookup<Viewlet>
  export let _class: Ref<Class<Doc>>
  export let query: DocumentQuery<Doc> = {}
  export let space: Ref<Space> | undefined

  export let viewOptions: ViewOptions

  export let createItemDialog: AnySvelteComponent | undefined = undefined
  export let createItemLabel: IntlString | undefined = undefined
  export let createItemEvent: string | undefined = undefined
  export let createItemDialogProps = { shouldSaveDraft: true }

  const hierarchy = getClient().getHierarchy()

  const preferenceQuery = createQuery()
  const objectConfigurations = createQuery()
  let preference: ViewletPreference[] = []

  let configurationsLoading = true
  let preferencesLoading = true
  $: loading = configurationsLoading || preferencesLoading

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
        loading = configurationsLoading || preferencesLoading
      }
    )
  }

  function updateConfiguration (configurationRaw: Viewlet[], preference: ViewletPreference[]): void {
    const newConfigurations: Record<Ref<Class<Doc>>, Viewlet['config']> = {}

    for (const v of configurationRaw) {
      newConfigurations[v.attachTo] = v.config
    }

    // Add viewlet configurations.
    for (const pref of preference) {
      if (pref.config.length > 0) {
        const vl = configurationRaw.find((it) => it._id === pref.attachedTo)
        if (vl !== undefined) {
          newConfigurations[vl.attachTo] = mergePreferenceConfig(pref.config, vl.config)
        }
      }
    }

    configurations = newConfigurations
  }

  $: fetchConfigurations(viewlet)
  $: fetchPreferences(configurationRaw)

  $: updateConfiguration(configurationRaw, preference)

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
      if (typeof p === 'string') return p
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
    const pref = preference.find((it) => it.attachedTo === viewlet._id)
    if (pref === undefined) return viewlet.config
    return mergePreferenceConfig(pref.config, viewlet.config)
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
