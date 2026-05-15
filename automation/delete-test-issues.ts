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
  const clientName = process.argv[3];

  if (!projetoId || !clientName) {
    console.log('Uso: npm run delete-test-issues -- <projetoId> "<clientName>"');
    console.log('Exemplo: npm run delete-test-issues -- 6a033a2f87d4dc88317f2d9a "teste"');
    return;
  }

  const url = HUB_TRANSACTOR_URL ?? 'https://3ftasks.3fventure.tech:3332';
  const readClient = createRestClient(url, workspaceId!, HUB_API_TOKEN);
  const writeClient = await createRestTxOperations(url, workspaceId!, HUB_API_TOKEN);

  const issues = await readClient.findAll(tracker.class.Issue, {
    space: projetoId as any,
    clientName: clientName as any
  });

  if (issues.length === 0) {
    console.log(`\n⚠️  Nenhuma task encontrada com clientName "${clientName}" no projeto.`);
    return;
  }

  console.log(`\n🗑️  Deletando ${issues.length} tasks com clientName "${clientName}":\n`);

  for (const issue of issues) {
    await writeClient.removeDoc(tracker.class.Issue, projetoId as any, issue._id);
    console.log(`   ✅ ${issue.identifier} — ${issue.title}`);
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n🎉 Tasks deletadas com sucesso!');
}

run().catch(console.error);
