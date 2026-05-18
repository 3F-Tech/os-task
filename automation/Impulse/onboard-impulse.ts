import { createRestTxOperations, createRestClient } from '@hcengineering/api-client';
import tracker from '@hcengineering/tracker';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Templates hardcoded por projeto
// IDs obtidos via: npm run list-templates-by-project -- <projetoId>
const TAREFAS_BASE: Array<{ projetoId: string; templateId: string; label: string }> = [
  // Impulse | 1. Coordenação (projeto: 6a033a2f87d4dc88317f2d9a)
  { projetoId: '6a033a2f87d4dc88317f2d9a', templateId: '6a0475a14c8dcb4083ddb09c', label: 'Breve Apresentação do Cliente para time interno' },
  { projetoId: '6a033a2f87d4dc88317f2d9a', templateId: '6a0475b34c8dcb4083ddb0aa', label: 'Handoff (vendas > operação)' },
  { projetoId: '6a033a2f87d4dc88317f2d9a', templateId: '6a0475ba4c8dcb4083ddb0b8', label: 'Estruturação de Tarefas Operacionais no 3F TASKS' },

  // Impulse | 2. Performance (projeto: 6a033a5587d4dc88317f2dbd)
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a047653e8250543d0eac607', label: 'Configuração de Estrutura Interna do Cliente' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a047667e8250543d0eac621', label: 'Reunião de Onboarding e Briefing Inicial' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a04766fe8250543d0eac62f', label: 'Montagem de Estratégia de Performance' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a047672e8250543d0eac63d', label: 'Reunião Interna de Revisão e Aprovação de Estratégia' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a04767be8250543d0eac64b', label: 'Reunião de Apresentação de Estratégia' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a04767fe8250543d0eac659', label: 'MicroImpactos' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a047695e8250543d0eac675', label: 'Impactos' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a0476a0e8250543d0eac68e', label: 'Setup de Estrutura de Performance' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a0476c2e8250543d0eac6ab', label: 'Acessos aos ativos digitais do cliente' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a0476c9e8250543d0eac6c7', label: 'Acessos aos materiais da marca' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a0476d9e8250543d0eac6e3', label: 'Ativar Primeiras Campanhas' },
];

// Tarefas adicionais criadas APENAS quando o cliente Impulse tem Social Media
const TAREFAS_SM: Array<{ projetoId: string; templateId: string; label: string }> = [
  // Impulse | 2. Performance (projeto: 6a033a5587d4dc88317f2dbd)
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a0476c6e8250543d0eac6b9', label: 'Montagem de Estratégia de Conteúdo' },
  { projetoId: '6a033a5587d4dc88317f2dbd', templateId: '6a0476f9e8250543d0eac73a', label: 'Ciclo PDCA de Comunicação' },

  // Impulse | 3. Planejamento & Design (projeto: 6a033a8087d4dc88317f2df3)
  { projetoId: '6a033a8087d4dc88317f2df3', templateId: '6a0477a9e8250543d0eac899', label: '[MÊS] Planejamento de Conteúdo' },

  // Impulse | 4. Audiovisual (projeto: 6a033aac87d4dc88317f2e22)
  { projetoId: '6a033aac87d4dc88317f2e22', templateId: '6a0477f5e8250543d0eac9d7', label: '[MÊS] Planejamento de Conteúdo' },
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

async function nextSequence(writeClient: any, projetoId: string, identifier: string): Promise<{ number: number; identifier: string }> {
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

async function run() {
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
    console.log('Uso: npm run onboard-impulse -- "Nome do Cliente" "com SM"');
    console.log('     npm run onboard-impulse -- "Nome do Cliente" "sem SM"');
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

  console.log(`\n✨ Iniciando onboarding Impulse: ${nomeCliente} (${smParam === 'com sm' ? 'com SM' : 'sem SM'})\n`);

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
          // Busca task types associados ao Space Type do projeto
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
        ...(pdcaDueDate !== null ? { dueDate: pdcaDueDate } : {}),
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

  console.log(`\n🎉 Onboarding Impulse concluído para "${nomeCliente}"!`);
}

run().catch(console.error);
