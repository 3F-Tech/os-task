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

  // Filtra por projeto se passado como argumento
  const projetoId = process.argv[2];

  const query = projetoId ? { space: projetoId as any } : {};
  const templates = await client.findAll(tracker.class.IssueTemplate, query);

  if (templates.length === 0) {
    console.log('⚠️  Nenhum template encontrado.');
    return;
  }

  // Agrupa por projeto
  const porProjeto = new Map<string, typeof templates>();
  for (const t of templates) {
    const key = t.space as string;
    if (!porProjeto.has(key)) porProjeto.set(key, []);
    porProjeto.get(key)!.push(t);
  }

  // Busca nomes dos projetos
  const projetos = await client.findAll(tracker.class.Project, {});
  const nomeProjeto = new Map(projetos.map(p => [p._id as string, p.name]));

  console.log(`\n📋 Templates encontrados (${templates.length} total):\n`);

  for (const [spaceId, lista] of porProjeto) {
    console.log(`📂 ${nomeProjeto.get(spaceId) ?? spaceId}`);
    for (const t of lista) {
      console.log(`   Nome:     ${t.title}`);
      console.log(`   ID:       ${t._id}`);
      if ((t as any).children?.length) {
        console.log(`   Subtarefas (${(t as any).children.length}):`);
        for (const c of (t as any).children) {
          console.log(`     - ${c.title}`);
        }
      }
      console.log('');
    }
    console.log('---');
  }
}

run().catch(console.error);
