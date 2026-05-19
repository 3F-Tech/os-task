import { createRestTxOperations, createRestClient } from '@hcengineering/api-client';
import tracker from '@hcengineering/tracker';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Templates hardcoded por projeto
// IDs obtidos via: npm run list-templates-by-project -- <projetoId>
const TAREFAS_BASE: Array<{ projetoId: string; templateId: string; label: string }> = [
  // Bomma | 1. Sucesso do Cliente (projeto: 6a037491cec98c57fca9e4d2)
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a0386cb9d1b435cda0e8532', label: 'Reunião de Onboarding | Boas-Vindas + Planejamento' },
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a0386e29d1b435cda0e854e', label: 'Reunião de Estratégia' },
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a0386b79d1b435cda0e8517', label: 'Onboarding' },
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a0386f99d1b435cda0e8569', label: 'Ponto de contato no grupo do cliente' },
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a0387049d1b435cda0e8577', label: 'Atualização Planilha Divisão de Clientes - Consolidado Geral' },
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a03870d9d1b435cda0e8585', label: 'Encontro mensal de Geração de Impacto' },
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a0387149d1b435cda0e8593', label: 'Consolidado Semanal - Panorama resultados comerciais' },
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a0387189d1b435cda0e85a1', label: 'Ligação com cliente' },
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a03871d9d1b435cda0e85af', label: 'Enviar NPS' },

  // Bomma | 2. Performance (projeto: 6a0374a9cec98c57fca9e4ef)
  { projetoId: '6a0374a9cec98c57fca9e4ef', templateId: '6a0387999d1b435cda0e8676', label: 'Ativar Primeira Campanha de Leads' },
  { projetoId: '6a0374a9cec98c57fca9e4ef', templateId: '6a0387889d1b435cda0e865c', label: 'Ativar Primeira Campanha de Aumento de Base' },
  { projetoId: '6a0374a9cec98c57fca9e4ef', templateId: '6a03874c9d1b435cda0e8620', label: 'Setup de Estrutura de Performance' },
  { projetoId: '6a0374a9cec98c57fca9e4ef', templateId: '6a0387729d1b435cda0e8640', label: 'Encontro 03 - Geração de Oportunidades' },
  { projetoId: '6a0374a9cec98c57fca9e4ef', templateId: '6a0387e79d1b435cda0e86aa', label: 'Reunião de Mensal de Performance' },
  { projetoId: '6a0374a9cec98c57fca9e4ef', templateId: '6a0387f79d1b435cda0e86c5', label: 'Otimização Campanhas' },
  { projetoId: '6a0374a9cec98c57fca9e4ef', templateId: '6a0388169d1b435cda0e86df', label: 'Solicitação de novos criativos' },
  { projetoId: '6a0374a9cec98c57fca9e4ef', templateId: '6a03881f9d1b435cda0e86ed', label: 'Consolidado Semanal - Panorama resultados de tráfego' },
  { projetoId: '6a0374a9cec98c57fca9e4ef', templateId: '6a0388349d1b435cda0e86fb', label: 'Verificação do Saldo | Envio de boletos/pix dos Ads' },

  // Bomma | 3. Social Media (projeto: 6a037558cec98c57fca9e5ca)
  { projetoId: '6a037558cec98c57fca9e5ca', templateId: '6a0479aee23f15e9fdd19557', label: 'Onboarding' },
  { projetoId: '6a037558cec98c57fca9e5ca', templateId: '6a0479c2e23f15e9fdd19574', label: 'Reunião mensal de planejamento de cronograma + Panorama de resultados' },

  // Bomma | 4. Planejamento & Design (projeto: 6a0374bfcec98c57fca9e50e)
  { projetoId: '6a0374bfcec98c57fca9e50e', templateId: '6a0388469d1b435cda0e873d', label: 'Onboarding Semana 02 - Marcar Reunião Inicial de Conteúdo' },
  { projetoId: '6a0374bfcec98c57fca9e50e', templateId: '6a0388579d1b435cda0e8757', label: 'Semana 01 do mês 02 | Encontro de 1º Cronograma + cronograma de stories' },
  { projetoId: '6a0374bfcec98c57fca9e50e', templateId: '6a0388639d1b435cda0e8765', label: '[Mês] Encontro de planejamento de conteúdo mensal + Panorama de Resultados' },

  // Bomma | 5. Audiovisual (projeto: 6a0374e5cec98c57fca9e550)
  { projetoId: '6a0374e5cec98c57fca9e550', templateId: '6a0612b2a2ab6b9edb306f76', label: '[MÊS] Planejamento de Conteúdo' },
];

const TAREFAS_SM: Array<{ projetoId: string; templateId: string; label: string }> = [
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a0381e89d1b435cda0e72ca', label: 'Cenário 01 e 02 com Social Media' },
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a0385a79d1b435cda0e84d0', label: 'Cenário 03 com Social Media' },
];

const TAREFAS_SEM_SM: Array<{ projetoId: string; templateId: string; label: string }> = [
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a0384c89d1b435cda0e844b', label: 'Cenário 01 e 02 sem Social Media' },
  { projetoId: '6a037491cec98c57fca9e4d2', templateId: '6a0385289d1b435cda0e84a6', label: 'Cenário 03 sem Social Media' },
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
  const cenarioParam = process.argv[4]?.toLowerCase();

  if (!nomeCliente || !smParam || !cenarioParam) {
    console.log('Uso: npm run onboard-bomma -- "Nome do Cliente" "com SM" "1e2"');
    console.log('     npm run onboard-bomma -- "Nome do Cliente" "com SM" "3"');
    console.log('     npm run onboard-bomma -- "Nome do Cliente" "sem SM" "1e2"');
    console.log('     npm run onboard-bomma -- "Nome do Cliente" "sem SM" "3"');
    return;
  }

  if (smParam !== 'com sm' && smParam !== 'sem sm') {
    console.error('❌ Parâmetro inválido. Use "com SM" ou "sem SM".');
    process.exit(1);
  }

  if (cenarioParam !== '1e2' && cenarioParam !== '3') {
    console.error('❌ Cenário inválido. Use "1e2" ou "3".');
    process.exit(1);
  }

  const smKey = smParam === 'com sm' ? TAREFAS_SM : TAREFAS_SEM_SM;
  const cenarioEntry = smKey.find(t =>
    cenarioParam === '1e2' ? t.label.includes('01 e 02') : t.label.includes('03')
  );
  const TAREFAS_ONBOARDING = cenarioEntry
    ? [...TAREFAS_BASE, cenarioEntry]
    : TAREFAS_BASE;

  const url = HUB_TRANSACTOR_URL ?? 'https://3ftasks.3fventure.tech:3332';
  const readClient = createRestClient(url, workspaceId!, HUB_API_TOKEN);
  const writeClient = await createRestTxOperations(url, workspaceId!, HUB_API_TOKEN);

  console.log(`\n✨ Iniciando onboarding Bomma: ${nomeCliente}\n`);

  // Cache de TagElements para popular title e color nas TagReferences
  const tagElements = await readClient.findAll('tags:class:TagElement' as any, {});
  const tagCache = new Map<string, { title: string; color?: number }>();
  for (const tag of tagElements) {
    tagCache.set(tag._id as string, { title: (tag as any).title ?? '', color: (tag as any).color });
  }

  // Cache de projetos para não buscar repetidamente
  const projetoCache = new Map<string, any>();

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
        kind: (template as any).kind,
        status: (template as any).status ?? projeto.defaultIssueStatus,
        estimation: (template as any).estimation ?? 0,
        clientName: nomeCliente,
        clientStage: (template as any).clientStage ?? 'onboarding',
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
          kind: (child as any).kind ?? (template as any).kind,
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

  console.log(`\n🎉 Onboarding Bomma concluído para "${nomeCliente}"!`);
}

run().catch(console.error);
