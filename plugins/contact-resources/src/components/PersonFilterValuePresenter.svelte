<!--
// Copyright © 2023 Hardcore Engineering Inc.
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
  import { Ref } from '@hcengineering/core'
  import { Person } from '@hcengineering/contact'
  import contact from '../plugin'
  import CombineAvatars from './CombineAvatars.svelte'

  export let value: Ref<Person>[]

  // ObjectFilter guarda refs diretas; ArrayFilter guarda tuplas [chave, [refs]] —
  // achata os dois formatos para a lista de refs reais
  $: items = Array.from(
    new Set(
      (value ?? []).flatMap((v) => (Array.isArray(v) ? (Array.isArray(v[1]) ? v[1] : []) : [v]))
    )
  ) as Ref<Person>[]
</script>

<CombineAvatars _class={contact.mixin.Employee} {items} limit={5} size={'x-small'} />
