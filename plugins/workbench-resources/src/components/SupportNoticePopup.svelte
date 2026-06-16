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
<script lang="ts">
  import { closePopup, Icon, IconClose, Label } from '@hcengineering/ui'
  import workbench from '../plugin'
  import { openSupportProject, SUPPORT_NOTICE_POPUP_CATEGORY } from '../supportNotice'

  function close (): void {
    closePopup(SUPPORT_NOTICE_POPUP_CATEGORY)
  }

  function openSupport (): void {
    openSupportProject()
    close()
  }
</script>

<div class="supportNoticePopup">
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="closeBtn" on:click={close}>
    <Icon icon={IconClose} size={'small'} />
  </div>

  <div class="title"><Label label={workbench.string.SupportNoticeTitle} /></div>
  <div class="body"><Label label={workbench.string.SupportNoticeBody} /></div>

  <div class="actions">
    <button class="secondary" on:click={close}>
      <Label label={workbench.string.SupportNoticeUnderstood} />
    </button>
    <button class="primary" on:click={openSupport}>
      <Label label={workbench.string.SupportNoticeOpen} />
    </button>
  </div>
</div>

<style lang="scss">
  .supportNoticePopup {
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 2rem;
    max-width: 32rem;
    background: var(--theme-popup-color);
    border: 1px solid var(--theme-popup-divider);
    border-radius: 1rem;
    box-shadow: var(--theme-popup-shadow);
  }

  .closeBtn {
    position: absolute;
    top: 1.25rem;
    right: 1.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    cursor: pointer;
    color: var(--theme-content-color);
    opacity: 0.7;

    &:hover {
      opacity: 1;
    }
  }

  .title {
    margin-right: 1.5rem;
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.875rem;
    color: var(--theme-caption-color);
  }

  .body {
    margin-top: 1rem;
    font-size: 1rem;
    line-height: 1.5rem;
    color: var(--theme-content-color);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 2rem;
  }

  button {
    padding: 0.625rem 1.25rem;
    font-size: 0.9375rem;
    font-weight: 600;
    border-radius: 0.625rem;
    cursor: pointer;
    border: 1px solid transparent;
    white-space: nowrap;

    &.secondary {
      color: var(--theme-caption-color);
      background: transparent;
      border-color: var(--theme-popup-divider);

      &:hover {
        background: var(--theme-button-hovered);
      }
    }

    &.primary {
      // CTA de alto contraste (branco no dark mode, escuro no light mode)
      color: var(--theme-popup-color);
      background: var(--theme-caption-color);
      border-color: var(--theme-caption-color);

      &:hover {
        opacity: 0.9;
      }
    }
  }
</style>
