import { createRestClient } from '@hcengineering/api-client';
import tracker from '@hcengineering/tracker';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

async function run() {
  const { HUB_TRANSACTOR_URL, HUB_WORKSPACE_ID, HUB_API_TOKEN } = process.env;
  const url = HUB_TRANSACTOR_URL || 'http://localhost:3332';

  if (!HUB_API_TOKEN || !HUB_WORKSPACE_ID) {
    console.error('❌ Erro: Configure o .env primeiro.');
    return;
  }

  const client = createRestClient(url, HUB_WORKSPACE_ID, HUB_API_TOKEN);
  console.log('🔍 Buscando templates no seu workspace...\n');

  const templates = await client.findAll(tracker.class.IssueTemplate, {});

  if (templates.length === 0) {
    console.log('⚠️ Nenhum template encontrado. Crie um no sistema em Settings -> Issue Templates.');
  } else {
    console.log('📋 Templates Disponíveis:');
    console.log('-----------------------');
    templates.forEach(t => {
      console.log(`- Nome: "${t.title}"`);
      console.log(`  ID:   ${t._id}\n`);
    });
  }
}

run().catch(console.error);
