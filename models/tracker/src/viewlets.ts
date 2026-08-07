//
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
//

import contact from '@hcengineering/contact'
import { SortingOrder } from '@hcengineering/core'
import { type Builder } from '@hcengineering/model'
import core from '@hcengineering/model-core'
import task from '@hcengineering/model-task'
import view, { createAttributePresenter, showColorsViewOption } from '@hcengineering/model-view'
import tags from '@hcengineering/tags'
import { type ViewOptionModel, type BuildModelKey, type ViewOptionsModel } from '@hcengineering/view'
import tracker from './plugin'

export const issuesOptions = (kanban: boolean): ViewOptionsModel => ({
  groupBy: [
    'status',
    'kind',
    'assignee',
    'priority',
    'space',
    'createdBy',
    'modifiedBy',
    'estimation',
    'remainingTime',
    'reportedTime',
    'clientName',
    'clientStage'
  ],
  orderBy: [
    ['modifiedOn', SortingOrder.Descending],
    ['status', SortingOrder.Ascending],
    ['kind', SortingOrder.Ascending],
    ['priority', SortingOrder.Ascending],
    ['createdOn', SortingOrder.Descending],
    ['dueDate', SortingOrder.Ascending],
    ['rank', SortingOrder.Ascending],
    ['estimation', SortingOrder.Descending],
    ['remainingTime', SortingOrder.Descending],
    ['reportedTime', SortingOrder.Descending]
  ],
  other: [
    {
      key: 'shouldShowSubIssues',
      type: 'toggle',
      defaultValue: false,
      actionTarget: 'query',
      action: tracker.function.SubIssueQuery,
      label: tracker.string.SubIssues
    },
    {
      key: 'shouldShowAll',
      type: 'toggle',
      defaultValue: false,
      actionTarget: 'category',
      action: view.function.ShowEmptyGroups,
      label: view.string.ShowEmptyGroups
    },
    {
      key: 'hideArchived',
      type: 'toggle',
      defaultValue: true,
      actionTarget: 'options',
      action: view.function.HideArchived,
      label: view.string.HideArchived
    },
    ...(!kanban ? [showColorsViewOption] : [])
  ]
})

export function issueConfig (
  key: string = '',
  compact: boolean = false,
  milestone: boolean = true,
  component: boolean = true
): (BuildModelKey | string)[] {
  return [
    {
      key: '',
      label: tracker.string.Priority,
      presenter: tracker.component.PriorityEditor,
      props: { type: 'priority', kind: 'list', size: 'small' },
      displayProps: { key: 'priority', hideLabel: true }
    },
    {
      key: '',
      label: tracker.string.Status,
      presenter: tracker.component.StatusEditor,
      props: { kind: 'list', size: 'small', justify: 'center' },
      displayProps: { key: key + 'status', hideLabel: true }
    },
    {
      key: '',
      label: tracker.string.Title,
      presenter: tracker.component.TitlePresenter,
      props: compact
        ? { shouldUseMargin: true, showParent: false, minWidth: '10rem' }
        : { minWidth: '10rem' },
      displayProps: { key: key + 'title' }
    },
    { key: '', displayProps: { grow: true } },
    {
      key: '',
      label: tracker.string.SubIssues,
      presenter: tracker.component.SubIssuesSelector,
      props: { size: 'small' },
      displayProps: { key: key + 'subIssues', compression: true, fixed: 'left', dividerBefore: true }
    },
    {
      key: '',
      label: tracker.string.ClientName,
      presenter: tracker.component.ClientNamePresenter,
      // Nome do cliente + badge da Etapa colados numa única célula (F12).
      // maxWidth trunca nomes longos com "…" (razão social gigante estourava a linha).
      props: { maxWidth: '12rem', showStage: true },
      displayProps: { key: key + 'clientName', compression: true, fixed: 'left', dividerBefore: true }
    },
    {
      key: 'labels',
      label: tracker.string.Labels,
      presenter: tags.component.LabelsPresenter,
      props: { kind: 'list', full: false },
      displayProps: { key: key + 'labels', compression: true, fixed: 'left', dividerBefore: true }
    },
    {
      key: '',
      label: tracker.string.Estimation,
      presenter: tracker.component.EstimationEditor,
      props: { kind: 'list', size: 'small' },
      displayProps: { key: key + 'estimation', compression: true, fixed: 'left', dividerBefore: true }
    },
    {
      key: '',
      label: tracker.string.Assignee,
      presenter: tracker.component.AssigneeEditor,
      displayProps: { key: 'assignee', compression: true, fixed: 'left', dividerBefore: true },
      props: { kind: 'list', shouldShowName: false, avatarSize: 'x-small' }
    },
    {
      key: '',
      label: tracker.string.DueDate,
      presenter: tracker.component.DueDatePresenter,
      displayProps: { key: key + 'dueDate', compression: true, fixed: 'left', dividerBefore: true },
      props: { kind: 'list' }
    },
    {
      key: 'identifier',
      label: task.string.Identifier,
      displayProps: { key: key + 'identifier', optional: true, compression: true, fixed: 'left', dividerBefore: true }
    },
    {
      key: 'kind',
      presenter: task.component.TaskTypePresenter,
      label: task.string.TaskType,
      props: { kind: 'list', size: 'small' },
      displayProps: { key: key + 'kind', optional: true, compression: true, fixed: 'left', dividerBefore: true }
    },
    {
      key: 'space',
      presenter: tracker.component.ProjectPresenter,
      label: tracker.string.Project,
      displayProps: { key: key + 'space', optional: true, compression: true, fixed: 'left', dividerBefore: true }
    },
    {
      key: 'startDate',
      presenter: view.component.DatePresenter,
      label: task.string.StartDate,
      props: { kind: 'list' },
      displayProps: { key: key + 'startDate', optional: true, compression: true, fixed: 'left', dividerBefore: true }
    },
    {
      key: 'createdOn',
      presenter: view.component.DatePresenter,
      label: core.string.CreatedDate,
      displayProps: { key: key + 'createdOn', optional: true, compression: true, fixed: 'left', dividerBefore: true }
    },
    {
      key: 'completedDate',
      presenter: view.component.DatePresenter,
      label: tracker.string.CompletedDate,
      props: { kind: 'list' },
      displayProps: { key: key + 'completedDate', optional: true, compression: true, fixed: 'left', dividerBefore: true }
    },
    {
      key: 'modifiedOn',
      presenter: tracker.component.ModificationDatePresenter,
      label: core.string.ModifiedDate,
      displayProps: { key: key + 'modifiedOn', optional: true, compression: true, fixed: 'left', dividerBefore: true }
    },
    {
      key: 'pdcaCycleActive',
      presenter: view.component.BooleanPresenter,
      label: tracker.string.PdcaCycleActive,
      displayProps: { key: key + 'pdcaCycleActive', optional: true, compression: true, fixed: 'left', dividerBefore: true }
    },
    {
      key: 'pdcaCycleFrequency',
      label: tracker.string.PdcaCycleFrequency,
      displayProps: { key: key + 'pdcaCycleFrequency', optional: true, compression: true, fixed: 'left', dividerBefore: true }
    }
  ]
}

export function defineViewlets (builder: Builder): void {
  // Cabeçalho de agrupamento por Etapa do Cliente (kanban/lista/filtros):
  // renderiza o badge em PT em vez do valor cru do enum.
  createAttributePresenter(builder, tracker.component.ClientStageValuePresenter, tracker.class.Issue, 'clientStage', 'attribute')

  builder.createDoc(
    view.class.ViewletDescriptor,
    core.space.Model,
    {
      label: tracker.string.Board,
      icon: task.icon.Kanban,
      component: tracker.component.KanbanView
    },
    tracker.viewlet.Kanban
  )

  builder.createDoc(
    view.class.Viewlet,
    core.space.Model,
    {
      attachTo: tracker.class.Issue,
      descriptor: view.viewlet.List,
      viewOptions: issuesOptions(false),
      configOptions: {
        strict: false,
        sortable: true,
        customFieldsGoRight: true,
        hiddenKeys: [
          'blockedBy',
          'relations',
          'description',
          'number',
          'reportedTime',
          'reports',
          'component',
          'milestone',
          'remainingTime',
          'attachedTo',
          'createdBy',
          'modifiedBy',
          'pdcaCycleResetStatus'
        ]
      },
      config: issueConfig()
    },
    tracker.viewlet.IssueList
  )

  const subIssuesOptions: ViewOptionsModel = {
    groupBy: ['status', 'kind', 'assignee', 'priority', 'milestone', 'createdBy', 'modifiedBy'],
    orderBy: [
      ['rank', SortingOrder.Ascending],
      ['kind', SortingOrder.Ascending],
      ['status', SortingOrder.Ascending],
      ['priority', SortingOrder.Ascending],
      ['modifiedOn', SortingOrder.Descending],
      ['createdOn', SortingOrder.Descending],
      ['dueDate', SortingOrder.Ascending]
    ],
    groupDepth: 1,
    other: [showColorsViewOption]
  }

  builder.createDoc(
    view.class.Viewlet,
    core.space.Model,
    {
      attachTo: tracker.class.Issue,
      descriptor: view.viewlet.List,
      viewOptions: subIssuesOptions,
      variant: 'subissue',
      configOptions: {
        strict: false,
        sortable: true,
        hiddenKeys: [
          'number',
          'milestone',
          'remainingTime',
          'createdBy',
          'modifiedBy'
        ]
      },
      config: issueConfig('sub', true, true)
    },
    tracker.viewlet.SubIssues
  )

  const milestoneIssueOptions: ViewOptionsModel = {
    groupBy: ['status', 'assignee', 'priority', 'component', 'createdBy', 'modifiedBy'],
    orderBy: [
      ['rank', SortingOrder.Ascending],
      ['status', SortingOrder.Ascending],
      ['priority', SortingOrder.Ascending],
      ['modifiedOn', SortingOrder.Descending],
      ['createdOn', SortingOrder.Descending],
      ['dueDate', SortingOrder.Ascending]
    ],
    groupDepth: 1,
    other: [showColorsViewOption]
  }

  builder.createDoc(
    view.class.Viewlet,
    core.space.Model,
    {
      attachTo: tracker.class.Issue,
      descriptor: view.viewlet.List,
      viewOptions: milestoneIssueOptions,
      variant: 'milestone',
      configOptions: {
        strict: false,
        sortable: true,
        hiddenKeys: [
          'number',
          'milestone',
          'remainingTime',
          'createdBy',
          'modifiedBy'
        ]
      },
      config: issueConfig('sub', true, false, true)
    },
    tracker.viewlet.MilestoneIssuesList
  )

  const componentIssueOptions: ViewOptionsModel = {
    groupBy: ['status', 'assignee', 'priority', 'milestone', 'createdBy', 'modifiedBy'],
    orderBy: [
      ['rank', SortingOrder.Ascending],
      ['status', SortingOrder.Ascending],
      ['priority', SortingOrder.Ascending],
      ['modifiedOn', SortingOrder.Descending],
      ['createdOn', SortingOrder.Descending],
      ['dueDate', SortingOrder.Ascending]
    ],
    groupDepth: 1,
    other: [showColorsViewOption]
  }

  builder.createDoc(
    view.class.Viewlet,
    core.space.Model,
    {
      attachTo: tracker.class.Issue,
      descriptor: view.viewlet.List,
      viewOptions: componentIssueOptions,
      variant: 'component',
      configOptions: {
        strict: false,
        sortable: true,
        hiddenKeys: [
          'number',
          'component',
          'remainingTime',
          'createdBy',
          'modifiedBy'
        ]
      },
      config: issueConfig('sub', true, true, false)
    },
    tracker.viewlet.ComponentIssuesList
  )

  builder.createDoc(
    view.class.Viewlet,
    core.space.Model,
    {
      attachTo: tracker.class.IssueTemplate,
      descriptor: view.viewlet.List,
      viewOptions: {
        groupBy: ['assignee', 'priority', 'component', 'milestone', 'createdBy', 'modifiedBy'],
        orderBy: [
          ['priority', SortingOrder.Ascending],
          ['modifiedOn', SortingOrder.Descending],
          ['dueDate', SortingOrder.Ascending],
          ['rank', SortingOrder.Ascending]
        ],
        other: [showColorsViewOption]
      },
      configOptions: {
        strict: true,
        hiddenKeys: [
          'milestone',
          'estimation',
          'remainingTime',
          'reportedTime',
          'component',
          'title',
          'description',
          'createdBy',
          'modifiedBy'
        ]
      },
      config: [
        // { key: '', presenter: tracker.component.PriorityEditor, props: { kind: 'list', size: 'small' } },
        {
          key: '',
          presenter: tracker.component.IssueTemplatePresenter,
          props: { type: 'issue', shouldUseMargin: true }
        },
        // { key: '', presenter: tracker.component.DueDatePresenter, props: { kind: 'list' } },
        {
          key: '',
          presenter: tracker.component.ComponentEditor,
          label: tracker.string.Component,
          props: {
            kind: 'list',
            size: 'small',
            shouldShowPlaceholder: false,
            maxWidth: '30rem'
          },
          displayProps: { key: 'component', compression: true }
        },
        {
          key: '',
          label: tracker.string.Milestone,
          presenter: tracker.component.MilestoneEditor,
          props: {
            kind: 'list',
            size: 'small',
            shouldShowPlaceholder: false,
            maxWidth: '30rem'
          },
          displayProps: { key: 'milestone', compression: true }
        },
        {
          key: '',
          label: tracker.string.ClientStage,
          presenter: tracker.component.ClientStagePresenter,
          props: { width: '8rem' },
          displayProps: { key: 'clientStage', compression: true, fixed: 'left', dividerBefore: true }
        },
        {
          key: '',
          label: tracker.string.Estimation,
          presenter: tracker.component.TemplateEstimationEditor,
          props: {
            kind: 'list',
            size: 'small'
          },
          displayProps: { key: 'estimation', compression: true, dividerBefore: true }
        },
        { key: '', displayProps: { grow: true } },
        {
          key: 'modifiedOn',
          presenter: tracker.component.ModificationDatePresenter,
          displayProps: { fixed: 'right', dividerBefore: true }
        },
        {
          key: 'assignee',
          presenter: tracker.component.AssigneeEditor,
          props: { kind: 'list', shouldShowName: false, avatarSize: 'x-small' }
        }
      ]
    },
    tracker.viewlet.IssueTemplateList
  )

  builder.createDoc(
    view.class.Viewlet,
    core.space.Model,
    {
      attachTo: tracker.class.Issue,
      descriptor: tracker.viewlet.Kanban,
      viewOptions: {
        ...issuesOptions(true),
        groupDepth: 1
      },
      configOptions: {
        strict: true
      },
      config: [
        'subIssues',
        'priority',
        'clientName',
        'clientStage',
        'dueDate',
        'labels',
        'estimation',
        'attachments',
        'comments'
      ]
    },
    tracker.viewlet.IssueKanban
  )

  const componentListViewOptions: ViewOptionsModel = {
    groupBy: ['lead', 'createdBy', 'modifiedBy'],
    orderBy: [
      ['modifiedOn', SortingOrder.Descending],
      ['createdOn', SortingOrder.Descending]
    ],
    other: [showColorsViewOption]
  }

  builder.createDoc(
    view.class.Viewlet,
    core.space.Model,
    {
      attachTo: tracker.class.Component,
      descriptor: view.viewlet.List,
      viewOptions: componentListViewOptions,
      configOptions: {
        strict: true,
        hiddenKeys: ['label', 'description']
      },
      config: [
        {
          key: '',
          presenter: tracker.component.ComponentPresenter,
          props: { kind: 'list' },
          displayProps: { key: 'component', fixed: 'left' }
        },
        { key: '', displayProps: { grow: true } },
        {
          key: '$lookup.lead',
          presenter: tracker.component.LeadPresenter,
          displayProps: {
            dividerBefore: true,
            key: 'lead'
          },
          props: { _class: tracker.class.Component, defaultClass: contact.mixin.Employee, shouldShowLabel: false }
        }
      ]
    },
    tracker.viewlet.ComponentList
  )

  const hideArchivedOption: ViewOptionModel = {
    key: 'hideArchived',
    type: 'toggle',
    defaultValue: false,
    actionTarget: 'options',
    action: view.function.HideArchived,
    label: view.string.HideArchived
  }

  const tableOptions: ViewOptionsModel = {
    groupBy: [],
    orderBy: [],
    other: [hideArchivedOption]
  }

  const projectListOptions: ViewOptionsModel = {
    groupBy: ['createdBy', 'modifiedBy'],
    orderBy: [
      ['name', SortingOrder.Ascending],
      ['identifier', SortingOrder.Ascending],
      ['modifiedOn', SortingOrder.Descending],
      ['createdOn', SortingOrder.Descending]
    ],
    other: [hideArchivedOption]
  }

  builder.createDoc(
    view.class.Viewlet,
    core.space.Model,
    {
      attachTo: tracker.class.Project,
      descriptor: view.viewlet.Table,
      viewOptions: tableOptions,
      configOptions: {
        hiddenKeys: ['identifier', 'name', 'description'],
        sortable: true
      },
      config: [
        {
          key: '',
          presenter: tracker.component.ProjectPresenter,
          props: {
            openIssues: true
          }
        },
        'members',
        {
          key: 'defaultAssignee',
          props: { kind: 'list' }
        },
        {
          key: 'modifiedOn',
          presenter: tracker.component.ModificationDatePresenter,
          displayProps: { fixed: 'right', dividerBefore: true }
        }
      ],
      options: {
        showArchived: true
      }
    },
    tracker.viewlet.ProjectList
  )

  builder.createDoc(
    view.class.Viewlet,
    core.space.Model,
    {
      attachTo: tracker.class.Project,
      descriptor: view.viewlet.List,
      viewOptions: projectListOptions,
      configOptions: {
        strict: true,
        hiddenKeys: ['identifier', 'name', 'description']
      },
      config: [
        {
          key: '',
          presenter: tracker.component.ProjectPresenter,
          props: {
            openIssues: true,
            shouldUseMargin: true
          }
        },
        'members',
        {
          key: 'defaultAssignee',
          props: { kind: 'list' }
        },
        {
          key: 'modifiedOn',
          presenter: tracker.component.ModificationDatePresenter,
          displayProps: { fixed: 'right', dividerBefore: true }
        }
      ],
      options: {
        showArchived: true
      }
    },
    tracker.viewlet.ProjectListGrouped
  )

  const milestoneOptions: ViewOptionsModel = {
    groupBy: ['status', 'createdBy', 'modifiedBy'],
    orderBy: [
      ['modifiedOn', SortingOrder.Descending],
      ['targetDate', SortingOrder.Descending],
      ['createdOn', SortingOrder.Descending]
    ],
    other: [showColorsViewOption]
  }

  builder.createDoc(
    view.class.Viewlet,
    core.space.Model,
    {
      attachTo: tracker.class.Milestone,
      descriptor: view.viewlet.List,
      viewOptions: milestoneOptions,
      configOptions: {
        strict: true,
        hiddenKeys: ['targetDate', 'label', 'description']
      },
      config: [
        {
          key: 'status',
          props: { width: '1rem', kind: 'list', size: 'small', justify: 'center' }
        },
        { key: '', presenter: tracker.component.MilestonePresenter, props: { shouldUseMargin: true } },
        { key: '', displayProps: { grow: true } },
        {
          key: '',
          label: tracker.string.TargetDate,
          presenter: tracker.component.MilestoneDatePresenter,
          props: { field: 'targetDate' }
        }
      ]
    },
    tracker.viewlet.MilestoneList
  )
}
