import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

const token = process.env.HUB_API_TOKEN;

if (!token) {
  console.error('❌ Token não encontrado no arquivo .env. Certifique-se de que HUB_API_TOKEN está preenchido.');
  process.exit(1);
}

try {
  // O token JWT tem o formato: header.payload.signature
  const base64Payload = token.split('.')[1];
  const payload = JSON.parse(Buffer.from(base64Payload, 'base64').toString());

  console.log('\n✅ Informações extraídas do seu Token:');
  console.log('--------------------------------------');
  console.log(`Workspace ID: ${payload.workspace || 'Não encontrado no payload'}`);
  console.log(`Account ID:   ${payload.account || 'Não encontrado'}`);
  console.log('--------------------------------------');
  console.log('\nCopie o Workspace ID acima e cole no seu arquivo .env no campo HUB_WORKSPACE_ID.\n');
} catch (e) {
  console.error('❌ Erro ao decodificar o token. Verifique se o token é um JWT válido.');
}
