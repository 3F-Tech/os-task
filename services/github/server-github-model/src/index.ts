//
// Copyright © 2023 Hardcore Engineering Inc.
//

import { type Builder } from '@hcengineering/model'

import core from '@hcengineering/core'
import serverCore from '@hcengineering/server-core'
import serverGithub from '@hcengineering/server-github'
import time from '@hcengineering/time'
import tracker from '@hcengineering/tracker'

export { serverGithubId } from '@hcengineering/server-github'

export function createModel (builder: Builder): void {
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverGithub.trigger.OnProjectChanges,
    isAsync: true
  })

  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverGithub.trigger.OnProjectRemove,
    txMatch: {
      _class: core.class.TxRemoveDoc,
      objectClass: tracker.class.Project
    }
  })

  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverGithub.trigger.OnGithubBroadcast,
    isAsync: false
  })

  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverGithub.trigger.OnTechIssueChange,
    isAsync: false,
    txMatch: {
      objectClass: tracker.class.Issue
    }
  })

  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverGithub.trigger.OnTechIssueCompletionCheck,
    isAsync: false,
    txMatch: {
      objectClass: tracker.class.Issue,
      _class: core.class.TxUpdateDoc
    }
  })

  // We should skip activity github mixin stuff.
  builder.createDoc(time.class.TodoAutomationHelper, core.space.Model, {
    onDoneTester: serverGithub.functions.TodoDoneTester
  })
}
