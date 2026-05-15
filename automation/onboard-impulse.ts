import { createRestTxOperations, createRestClient } from '@hcengineering/api-client';
import tracker from '@hcengineering/tracker';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

// Tarefas de onboarding da BU Impulse — será preenchido na próxima etapa
// Formato: { projeto: nome exato do projeto no sistema, titulo: título da tarefa }
// Use {cliente} no título para substituição automática pelo nome do cliente
const TAREFAS_ONBOARDING: Array<{ projeto: string; titulo: string }> = [
  // TODO
];

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
  if (!nomeCliente) {
    console.log('Uso: npm run onboard-impulse -- "Nome do Cliente"');
    return;
  }

  const url = HUB_TRANSACTOR_URL ?? 'https://3ftasks.3fventure.tech:3332';
  const readClient = createRestClient(url, workspaceId!, HUB_API_TOKEN);
  const writeClient = await createRestTxOperations(url, workspaceId!, HUB_API_TOKEN);

  console.log(`\n✨ Iniciando onboarding Impulse: ${nomeCliente}\n`);

  for (const { projeto: nomeProjeto, titulo } of TAREFAS_ONBOARDING) {
    const projeto = await readClient.findOne(tracker.class.Project, { name: nomeProjeto });
    if (!projeto) {
      console.warn(`⚠️  Projeto não encontrado: "${nomeProjeto}" — pulando`);
      continue;
    }

    const incResult = await writeClient.updateDoc(
      tracker.class.Project,
      'space:class:Space' as any,
      projeto._id,
      { $inc: { sequence: 1 } } as any,
      true
    );
    const number = (incResult as any).object.sequence;
    const identifier = `${projeto.identifier}-${number}`;
    const tituloFinal = titulo.replace(/{cliente}/gi, nomeCliente);

    await writeClient.addCollection(
      tracker.class.Issue,
      projeto._id,
      'tracker:ids:NoParent' as any,
      tracker.class.Issue,
      'subIssues',
      {
        title: tituloFinal,
        identifier,
        number,
        rank: '0|hzzzzz:',
        priority: 0,
        status: projeto.defaultIssueStatus,
        space: projeto._id,
        attachedTo: 'tracker:ids:NoParent',
        attachedToClass: tracker.class.Issue,
        collection: 'subIssues',
      } as any
    );

    console.log(`  ✅ ${identifier} — ${tituloFinal}`);
  }

  console.log(`\n🎉 Onboarding Impulse concluído para "${nomeCliente}"!`);
}

run().catch(console.error);
