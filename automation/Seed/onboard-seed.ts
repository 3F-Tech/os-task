import { createRestTxOperations, createRestClient } from '@hcengineering/api-client';
import tracker from '@hcengineering/tracker';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Templates hardcoded por projeto
// IDs obtidos via: npm run list-templates-by-project -- <projetoId>
const TAREFAS_BASE: Array<{ projetoId: string; templateId: string; label: string }> = [
  // Seed | 1. Coordenação (projeto: 6a0215ac91e156605a9fed2d)
  { projetoId: '6a0215ac91e156605a9fed2d', templateId: '6a047b19e23f15e9fdd19857', label: 'Breve Apresentação do Cliente para time interno' },
  { projetoId: '6a0215ac91e156605a9fed2d', templateId: '6a047b0fe23f15e9fdd19846', label: 'Handoff (vendas > operação)' },
  { projetoId: '6a0215ac91e156605a9fed2d', templateId: '6a047b21e23f15e9fdd19868', label: 'Estruturação de Tarefas Operacionais no 3F TASKS' },

  // Seed | 2. Performance (projeto: 69fce02121c2dabdabe3d3b7)
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047b76e23f15e9fdd19888', label: 'Configuração de Estrutura Interna do Cliente' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047b8be23f15e9fdd198a5', label: 'Reunião de Onboarding e Briefing Inicial' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047b96e23f15e9fdd198b6', label: 'Montagem de Estratégia de Performance' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047b9ee23f15e9fdd198c7', label: 'Reunião Interna de Revisão e Aprovação de Estratégia' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047ba7e23f15e9fdd198d8', label: 'Reunião de Apresentação de Estratégia' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047bb0e23f15e9fdd198e9', label: 'MicroImpactos' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047bc4e23f15e9fdd19908', label: 'Impactos' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047bd3e23f15e9fdd19925', label: 'Setup de Estrutura de Performance' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047bede23f15e9fdd19945', label: 'Acessos aos ativos digitais do cliente' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047bfce23f15e9fdd19969', label: 'Acessos aos materiais da marca' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047c01e23f15e9fdd1997a', label: 'Ativar Primeiras Campanhas' },
];

// Tarefas adicionais criadas APENAS quando o cliente Seed tem Social Media
const TAREFAS_SM: Array<{ projetoId: string; templateId: string; label: string }> = [
  // Seed | 2. Performance (projeto: 69fce02121c2dabdabe3d3b7)
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047bf5e23f15e9fdd19958', label: 'Montagem de Estratégia de Conteúdo' },
  { projetoId: '69fce02121c2dabdabe3d3b7', templateId: '6a047c3fe23f15e9fdd1998b', label: 'Ciclo PDCA de Comunicação' },

  // Seed | 3. Planejamento & Design (projeto: 6a021ebc3e05e60cba80d8ca)
  { projetoId: '6a021ebc3e05e60cba80d8ca', templateId: '6a060dc8a699f2bce935fd00', label: '[MÊS] Planejamento de Conteúdo' },

  // Seed | 4. Audiovisual (projeto: 6a0220f3b0af3ef0cc3088b7)
  { projetoId: '6a0220f3b0af3ef0cc3088b7', templateId: '6a060d07a699f2bce935fa03', label: '[MÊS] Planejamento de Conteúdo' },
];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type PdcaFreq = 'weekly' | 'biweekly' | 'monthly' | 'quarterly';

// Due date do ciclo PDCA *atual* — diferente do worker, que pula para o PRÓXIMO ciclo.
// Aqui aceitamos datas já passadas (ex.: terça desta semana mesmo se hoje for sexta).
function calculateCurrentCycleDueDate (frequency: PdcaFreq | undefined, dueDays: number[] | undefined): number | null {
  if (frequency === undefined || dueDays === undefined || dueDays.length === 0) return null;
  const now = new Date();

  if (frequency === 'weekly') {
    const targetWeekday = dueDays[0];
    const diff = targetWeekday - now.getDay();
    const due = new Date(now);
    due.setDate(now.getDate() + diff);
    due.setHours(23, 59, 0, 0);
    return due.getTime();
  }

  if (frequency === 'monthly' || frequency === 'quarterly') {
    const targetDay = dueDays[0];
    return new Date(now.getFullYear(), now.getMonth(), targetDay, 23, 59, 0, 0).getTime();
  }

  if (frequency === 'biweekly') {
    const sorted = [...dueDays].sort((a, b) => a - b);
    const todayDay = now.getDate();
    const past = [...sorted].reverse().find((d) => d <= todayDay);
    const target = past ?? sorted[0];
    return new Date(now.getFullYear(), now.getMonth(), target, 23, 59, 0, 0).getTime();
  }

  return null;
}

async function nextSequence (writeClient: any, projetoId: string, identifier: string): Promise<{ number: number; identifier: string }> {
  const inc = await writeClient.updateDoc(
    tracker.class.Project,
    'space:class:Space' as any,
    projetoId,
    { $inc: { sequence: 1 } } as any,
    true
  );
  const number = (inc as any).object.sequence;
  return { number, identifier: `${identifier}-${number}` };
}

async function run () {
  const { HUB_TRANSACTOR_URL, HUB_WORKSPACE_ID, HUB_API_TOKEN } = process.env;

  if (!HUB_API_TOKEN) {
    console.error('❌ HUB_API_TOKEN não configurado no .env');
    process.exit(1);
  }

  let workspaceId = HUB_WORKSPACE_ID;
  if (!workspaceId) {
    const payload = JSON.parse(Buffer.from(HUB_API_TOKEN.split('.')[1], 'base64').toString());
    workspaceId = payload.workspace;
    console.log(`ℹ️ Workspace: ${workspaceId}`);
  }

  const nomeCliente = process.argv[2];
  const smParam = process.argv[3]?.toLowerCase();

  if (!nomeCliente || !smParam) {
    console.log('Uso: npm run onboard-seed -- "Nome do Cliente" "com SM"');
    console.log('     npm run onboard-seed -- "Nome do Cliente" "sem SM"');
    return;
  }

  if (smParam !== 'com sm' && smParam !== 'sem sm') {
    console.error('❌ Parâmetro inválido. Use "com SM" ou "sem SM".');
    process.exit(1);
  }

  const TAREFAS_ONBOARDING = smParam === 'com sm'
    ? [...TAREFAS_BASE, ...TAREFAS_SM]
    : TAREFAS_BASE;

  const url = HUB_TRANSACTOR_URL ?? 'https://3ftasks.3fventure.tech:3332';
  const readClient = createRestClient(url, workspaceId!, HUB_API_TOKEN);
  const writeClient = await createRestTxOperations(url, workspaceId!, HUB_API_TOKEN);

  console.log(`\n✨ Iniciando onboarding Seed: ${nomeCliente} (${smParam === 'com sm' ? 'com SM' : 'sem SM'})\n`);

  // Cache de TagElements para popular title e color nas TagReferences
  const tagElements = await readClient.findAll('tags:class:TagElement' as any, {});
  const tagCache = new Map<string, { title: string; color?: number }>();
  for (const tag of tagElements) {
    tagCache.set(tag._id as string, { title: (tag as any).title ?? '', color: (tag as any).color });
  }

  // Cache de projetos e kinds para não buscar repetidamente
  const projetoCache = new Map<string, any>();
  const kindCache = new Map<string, string>();

  for (const { projetoId, templateId, label } of TAREFAS_ONBOARDING) {
    if (!projetoCache.has(projetoId)) {
      const p = await readClient.findOne(tracker.class.Project, { _id: projetoId as any });
      if (!p) {
        console.warn(`⚠️  Projeto não encontrado: ${projetoId} — pulando`);
        continue;
      }
      projetoCache.set(projetoId, p);
    }
    const projeto = projetoCache.get(projetoId);

    const template = await readClient.findOne(tracker.class.IssueTemplate, { _id: templateId as any });
    if (!template) {
      console.warn(`⚠️  Template não encontrado: ${templateId} (${label}) — pulando`);
      continue;
    }

    // Resolve kind: usa o do template → issue existente → task type do Space Type
    if (!kindCache.has(projetoId)) {
      const kindDoTemplate = (template as any).kind;
      if (kindDoTemplate) {
        kindCache.set(projetoId, kindDoTemplate);
      } else {
        const issueExistente = await readClient.findOne(tracker.class.Issue, { space: projetoId as any });
        if (issueExistente?.kind) {
          kindCache.set(projetoId, issueExistente.kind as any);
        } else {
          const taskTypes = await readClient.findAll('task:class:TaskType' as any, { parent: (projeto as any).type as any });
          if (taskTypes.length > 0) {
            kindCache.set(projetoId, taskTypes[0]._id as any);
          }
        }
      }
    }
    const kind = kindCache.get(projetoId);

    // Cria tarefa principal
    const seq = await nextSequence(writeClient, projetoId, projeto.identifier);
    const pdcaActive = (template as any).pdcaCycleActive === true;
    const pdcaFrequency = (template as any).pdcaCycleFrequency as PdcaFreq | undefined;
    const pdcaDueDays = (template as any).pdcaCycleDueDays as number[] | undefined;
    const pdcaDueDate = pdcaActive ? calculateCurrentCycleDueDate(pdcaFrequency, pdcaDueDays) : null;

    const tarefaId = await writeClient.addCollection(
      tracker.class.Issue,
      projetoId,
      'tracker:ids:NoParent' as any,
      tracker.class.Issue,
      'subIssues',
      {
        title: template.title,
        identifier: seq.identifier,
        number: seq.number,
        rank: '0|hzzzzz:',
        priority: template.priority ?? 0,
        kind,
        status: (template as any).status ?? projeto.defaultIssueStatus,
        estimation: (template as any).estimation ?? 0,
        clientName: nomeCliente,
        clientStage: 'onboarding',
        pdcaCycleActive: pdcaActive,
        pdcaCycleFrequency: pdcaFrequency,
        pdcaCycleDueDays: pdcaDueDays,
        pdcaCycleResetStatus: (template as any).pdcaCycleResetStatus,
        dueDate: pdcaDueDate,
        space: projetoId,
        attachedTo: 'tracker:ids:NoParent',
        attachedToClass: tracker.class.Issue,
        collection: 'subIssues',
        template: { template: templateId },
      } as any
    );

    // Cria TagReferences para as labels da tarefa pai
    for (const labelId of (template as any).labels ?? []) {
      const tagInfo = tagCache.get(labelId as string) ?? { title: '' };
      await writeClient.addCollection(
        'tags:class:TagReference' as any,
        projetoId,
        tarefaId,
        tracker.class.Issue,
        'labels',
        { tag: labelId, title: tagInfo.title, color: tagInfo.color } as any
      );
    }

    console.log(`  ✅ ${seq.identifier} — ${template.title}`);

    // Cria subtarefas
    const children = (template as any).children ?? [];
    for (const child of children) {
      const subSeq = await nextSequence(writeClient, projetoId, projeto.identifier);
      const subId = await writeClient.addCollection(
        tracker.class.Issue,
        projetoId,
        tarefaId,
        tracker.class.Issue,
        'subIssues',
        {
          title: child.title,
          identifier: subSeq.identifier,
          number: subSeq.number,
          rank: '0|hzzzzz:',
          priority: child.priority ?? 0,
          kind: (child as any).kind ?? kind,
          status: child.status ?? projeto.defaultIssueStatus,
          estimation: child.estimation ?? 0,
          space: projetoId,
          attachedTo: tarefaId,
          attachedToClass: tracker.class.Issue,
          collection: 'subIssues',
        } as any
      );

      // Cria TagReferences para as labels da subtarefa
      for (const labelId of child.labels ?? []) {
        const tagInfo = tagCache.get(labelId as string) ?? { title: '' };
        await writeClient.addCollection(
          'tags:class:TagReference' as any,
          projetoId,
          subId,
          tracker.class.Issue,
          'labels',
          { tag: labelId, title: tagInfo.title, color: tagInfo.color } as any
        );
      }

      console.log(`     ↳ ${subSeq.identifier} — ${child.title}`);
      await sleep(800);
    }

    await sleep(1500);
  }

  console.log(`\n🎉 Onboarding Seed concluído para "${nomeCliente}"!`);
}

run().catch(console.error);
