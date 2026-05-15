import { createRestTxOperations, createRestClient } from '@hcengineering/api-client';
import tracker from '@hcengineering/tracker';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

async function run() {
  const { HUB_TRANSACTOR_URL, HUB_WORKSPACE_ID, HUB_API_TOKEN } = process.env;

  if (!HUB_API_TOKEN) { console.error('❌ HUB_API_TOKEN não configurado'); process.exit(1); }

  let workspaceId = HUB_WORKSPACE_ID;
  if (!workspaceId) {
    const payload = JSON.parse(Buffer.from(HUB_API_TOKEN.split('.')[1], 'base64').toString());
    workspaceId = payload.workspace;
  }

  const projetoId = process.argv[2];
  if (!projetoId) {
    console.log('Uso: npm run fix-issues -- <projetoId>');
    return;
  }

  const url = HUB_TRANSACTOR_URL ?? 'https://3ftasks.3fventure.tech:3332';
  const readClient = createRestClient(url, workspaceId!, HUB_API_TOKEN);
  const writeClient = await createRestTxOperations(url, workspaceId!, HUB_API_TOKEN);

  // Busca o projeto
  const projeto = await readClient.findOne(tracker.class.Project, { _id: projetoId as any });
  if (!projeto) { console.error('❌ Projeto não encontrado'); process.exit(1); }

  console.log(`\n📂 Projeto: ${projeto.name}`);
  console.log(`   defaultIssueStatus: ${projeto.defaultIssueStatus}`);

  // Busca os statuses configurados no projeto
  const statuses = await readClient.findAll(tracker.class.IssueStatus, { space: projetoId as any });
  console.log(`\n📋 Statuses disponíveis (${statuses.length}):`);
  statuses.forEach(s => console.log(`   ${s._id} — ${(s as any).name ?? s._id}`));

  if (statuses.length === 0) {
    console.error('\n❌ Nenhum status encontrado neste projeto. Verifique a configuração do Space Type na UI.');
    return;
  }

  // Usa o defaultIssueStatus do projeto, ou o primeiro status disponível
  const statusCorreto = projeto.defaultIssueStatus ?? statuses[0]._id;
  console.log(`\n✅ Status que será aplicado: ${statusCorreto}`);

  // Busca todas as tasks com status de backlog (quebrado)
  const tasksBug = await readClient.findAll(
    tracker.class.Issue,
    { space: projetoId as any, status: 'tracker:status:Backlog' as any }
  );

  if (tasksBug.length === 0) {
    console.log('\n✅ Nenhuma task com status quebrado encontrada.');
    return;
  }

  console.log(`\n🔧 Corrigindo ${tasksBug.length} tasks...\n`);

  for (const task of tasksBug) {
    await writeClient.updateDoc(
      tracker.class.Issue,
      projetoId as any,
      task._id,
      { status: statusCorreto } as any
    );
    console.log(`   ✅ ${task.identifier} — ${task.title}`);
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n🎉 Correção concluída!');
}

run().catch(console.error);
