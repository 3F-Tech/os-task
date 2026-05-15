import { createRestClient } from '@hcengineering/api-client';
import tracker from '@hcengineering/tracker';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

async function run() {
  const { HUB_TRANSACTOR_URL, HUB_WORKSPACE_ID, HUB_API_TOKEN } = process.env;
  const url = HUB_TRANSACTOR_URL ?? 'https://3ftasks.3fventure.tech:3332';

  const projetoId = process.argv[2];

  const client = createRestClient(url, HUB_WORKSPACE_ID!, HUB_API_TOKEN!);

  const query = projetoId ? { space: projetoId as any } : {};
  console.log(projetoId
    ? `🔍 Raio-X das últimas tarefas do projeto ${projetoId}...\n`
    : '🔍 Raio-X das últimas tarefas (geral)...\n'
  );

  const tarefas = await client.findAll(tracker.class.Issue, query, { limit: 3, sort: { modifiedOn: -1 } });

  if (tarefas.length === 0) {
    console.log('⚠️  Nenhuma tarefa encontrada.');
    return;
  }

  tarefas.forEach(t => {
    console.log(`=== ${t.identifier} — ${t.title} ===`);
    console.log(JSON.stringify(t, null, 2));
    console.log('=============================\n');
  });
}

run().catch(console.error);
