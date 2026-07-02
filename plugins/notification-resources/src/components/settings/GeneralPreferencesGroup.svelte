<!--
// Copyright © 2024 Hardcore Engineering Inc.
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

<script lang="ts">
  import { createQuery, getClient } from '@hcengineering/presentation'
  import notification, { NotificationProvider, OnlyAssignedTasksSetting } from '@hcengineering/notification'
  import core, { Ref } from '@hcengineering/core'
  import { getResource } from '@hcengineering/platform'
  import { Icon, Label, ModernToggle } from '@hcengineering/ui'

  import { providersSettings } from '../../utils'
  import ProviderPreferences from './ProviderPreferences.svelte'

  const client = getClient()

  const onlyAssignedQuery = createQuery()
  let onlyAssignedSettings: OnlyAssignedTasksSetting[] = []
  onlyAssignedQuery.query(notification.class.OnlyAssignedTasksSetting, { space: core.space.Workspace }, (res) => {
    onlyAssignedSettings = res
  })
  // Espelha a regra do servidor: ligada se QUALQUER doc estiver enabled.
  $: onlyAssignedEnabled = onlyAssignedSettings.some((s) => s.enabled)

  async function toggleOnlyAssigned (): Promise<void> {
    const enabled = !onlyAssignedEnabled
    if (onlyAssignedSettings.length === 0) {
      await client.createDoc(notification.class.OnlyAssignedTasksSetting, core.space.Workspace, {
        attachedTo: notification.providers.InboxNotificationProvider,
        enabled
      })
    } else {
      // Pode haver docs duplicados (corridas antigas). Mantém o 1o com o novo
      // valor e remove os demais, garantindo estado consistente com o servidor.
      await client.update(onlyAssignedSettings[0], { enabled })
      for (const dup of onlyAssignedSettings.slice(1)) {
        await client.removeDoc(dup._class, dup.space, dup._id)
      }
    }
  }
  const providers = client
    .getModel()
    .findAllSync(notification.class.NotificationProvider, {})
    .sort((provider1, provider2) => provider1.order - provider2.order)

  function getProviderStatus (ref: Ref<NotificationProvider>): boolean {
    const provider = providers.find(({ _id }) => _id === ref)

    if (provider === undefined) return false

    const setting = $providersSettings.find(({ attachedTo }) => attachedTo === provider._id)
    return setting?.enabled ?? provider.defaultEnabled
  }

  async function updateStatus (ref: Ref<NotificationProvider>, enabled: boolean): Promise<void> {
    const setting = $providersSettings.find(({ attachedTo }) => attachedTo === ref)
    if (setting !== undefined) {
      await client.update(setting, { enabled })
      setting.enabled = enabled
    } else {
      await client.createDoc(notification.class.NotificationProviderSetting, core.space.Workspace, {
        attachedTo: ref,
        enabled
      })
    }
  }

  async function onToggle (event: CustomEvent): Promise<void> {
    const provider = event.detail
    if (provider == null) return

    const setting = $providersSettings.find(({ attachedTo }) => attachedTo === provider._id)
    const enabled = setting !== undefined ? !setting.enabled : !provider.defaultEnabled

    await updateStatus(provider._id, enabled)

    if (enabled && provider?.depends !== undefined) {
      const current = getProviderStatus(provider.depends)
      if (!current) {
        await updateStatus(provider.depends, true)
      }
    } else if (!enabled) {
      const dependents = providers.filter((p) => p.depends === provider._id)
      for (const dependent of dependents) {
        await updateStatus(dependent._id, false)
      }
    }
  }
</script>

<div class="flex-col flex-gap-4">
  {#each providers as provider (provider._id)}
    {#if provider.isAvailableFn}
      {#await getResource(provider.isAvailableFn) then isAvailableFn}
        {#if isAvailableFn()}
          <ProviderPreferences {provider} on:toggle={onToggle} />
        {/if}
      {/await}
    {:else}
      <ProviderPreferences {provider} on:toggle={onToggle} />
    {/if}
  {/each}

  <div class="flex-row-top flex-gap-2">
    <div class="flex-col flex-gap-2 w-120">
      <div class="flex-row-center flex-gap-2">
        <Icon icon={notification.icon.Notifications} size="medium" />
        <span class="label font-semi-bold">
          <Label label={notification.string.OnlyAssignedTasks} />
        </span>
      </div>
      <span class="description">
        <Label label={notification.string.OnlyAssignedTasksDescription} />
      </span>
    </div>
    <ModernToggle size="small" checked={onlyAssignedEnabled} on:change={toggleOnlyAssigned} />
  </div>
</div>

<style lang="scss">
  .label {
    color: var(--global-primary-TextColor);
  }

  .description {
    color: var(--global-secondary-TextColor);
  }
</style>
