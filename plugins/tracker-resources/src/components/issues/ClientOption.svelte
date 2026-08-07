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
  F12 — item do seletor de clientes da 3F Core (usado como `component` dos itens
  do SelectPopup em openClientPopup). Mostra o rótulo do cliente e, quando ele
  está em churn, uma "tag" vermelha à direita.
-->
<script lang="ts">
  export let label: string
  export let churn: boolean = false
</script>

<span class="client-option">
  <span class="name overflow-label">{label}</span>
  {#if churn}<span class="churn-tag">churn</span>{/if}
</span>

<style lang="scss">
  .client-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    min-width: 0;
  }
  .name {
    flex: 1 1 auto;
    min-width: 0;
  }
  .churn-tag {
    flex-shrink: 0;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    font-size: 0.625rem;
    font-weight: 700;
    line-height: 1.4;
    padding: 1px 6px;
    border-radius: 8px;
    color: #fff;
    background: #ef4444;
  }
</style>
