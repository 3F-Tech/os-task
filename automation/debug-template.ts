import { createRestClient } from '@hcengineering/api-client';
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

  const templateId = process.argv[2];
  const issueId = process.argv[3];

  if (!templateId) {
    console.log('Uso: npm run debug-template -- <templateId> [issueId]');
    console.log('Exemplo: npm run debug-template -- 6a0386b79d1b435cda0e8517 6a0613d4b01f00135b9d90f7');
    return;
  }

  const url = HUB_TRANSACTOR_URL ?? 'https://3ftasks.3fventure.tech:3332';
  const client = createRestClient(url, workspaceId!, HUB_API_TOKEN);

  const template = await client.findOne(tracker.class.IssueTemplate, { _id: templateId as any });
  console.log('\n=== TEMPLATE ===');
  console.log(JSON.stringify(template, null, 2));

  if (issueId) {
    const issue = await client.findOne(tracker.class.Issue, { _id: issueId as any });
    console.log('\n=== ISSUE ===');
    console.log(JSON.stringify(issue, null, 2));

    // Busca TagReferences vinculadas à issue
    const tagRefs = await client.findAll(
      'tags:class:TagReference' as any,
      { attachedTo: issueId as any }
    );
    console.log('\n=== TAG REFERENCES DA ISSUE ===');
    console.log(JSON.stringify(tagRefs, null, 2));
  }
}

run().catch(console.error);
