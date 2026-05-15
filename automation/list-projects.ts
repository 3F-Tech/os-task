import { createRestClient } from '@hcengineering/api-client';
import tracker from '@hcengineering/tracker';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

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
  }

  const url = HUB_TRANSACTOR_URL ?? 'https://3ftasks.3fventure.tech:3332';
  const client = createRestClient(url, workspaceId!, HUB_API_TOKEN);

  const projetos = await client.findAll(tracker.class.Project, {});

  if (projetos.length === 0) {
    console.log('⚠️  Nenhum projeto encontrado.');
    return;
  }

  console.log(`\n📂 Projetos no workspace (${projetos.length} encontrados):\n`);
  projetos.forEach(p => {
    console.log(`Nome:       ${p.name}`);
    console.log(`ID:         ${p._id}`);
    console.log(`Identifier: ${p.identifier}`);
    console.log('---');
  });
}

run().catch(console.error);
