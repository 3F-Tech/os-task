import { createRestTxOperations, createRestClient } from '@hcengineering/api-client';
import tracker from '@hcengineering/tracker';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Carrega o arquivo .env
dotenv.config({ path: path.join(__dirname, '.env') });

const {
  HUB_TRANSACTOR_URL,
  HUB_WORKSPACE_ID,
  HUB_API_TOKEN
} = process.env;

async function run() {
  if (!HUB_API_TOKEN) {
    console.error('❌ Erro: HUB_API_TOKEN não configurado no arquivo .env');
    process.exit(1);
  }

  // Se o Workspace ID não for fornecido, tenta extrair do Token JWT
  let workspaceId = HUB_WORKSPACE_ID;
  if (!workspaceId) {
    try {
      const base64Payload = HUB_API_TOKEN.split('.')[1];
      const payload = JSON.parse(Buffer.from(base64Payload, 'base64').toString());
      workspaceId = payload.workspace;
      if (workspaceId) {
        console.log(`ℹ️ Workspace ID detectado automaticamente do token: ${workspaceId}`);
      }
    } catch (e) {
      console.error('❌ Erro ao tentar extrair Workspace ID do token. Verifique se o token é válido.');
      process.exit(1);
    }
  }

  if (!workspaceId) {
    console.error('❌ Erro: Workspace ID não encontrado. Preencha HUB_WORKSPACE_ID no .env ou use um token válido.');
    process.exit(1);
  }

  const nomeCliente = process.argv[2];
  const templateNameOrId = process.argv[3];
  const projetoAlvoNameOrId = process.argv[4]; // Novo argumento opcional

  if (!nomeCliente || !templateNameOrId) {
    console.log('\n🚀 3F Hub - Automação de Onboarding');
    console.log('Uso: npm run onboard -- "Nome do Cliente" "Nome do Template" ["Nome do Projeto"]');
    console.log('Exemplos:');
    console.log('  npm run onboard -- "Cliente Teste" "Template Padrao"');
    console.log('  npm run onboard -- "Cliente Teste" "Template Padrao" "Projeto Comercial"\n');
    return;
  }

  const url = HUB_TRANSACTOR_URL || 'http://localhost:3332';
  
  console.log('🔌 Conectando ao 3F Hub...');
  const readClient = createRestClient(url, workspaceId, HUB_API_TOKEN);
  const writeClient = await createRestTxOperations(url, workspaceId, HUB_API_TOKEN);

  console.log(`🔍 Buscando template: "${templateNameOrId}"...`);
  
  // Busca o template pelo nome
  let templates = await readClient.findAll(tracker.class.IssueTemplate, { 
    title: templateNameOrId 
  });
  
  // Se não achar pelo nome, tenta pelo ID
  if (templates.length === 0) {
    templates = await readClient.findAll(tracker.class.IssueTemplate, { 
      _id: templateNameOrId as any 
    });
  }
  
  const template = templates[0];
  if (!template) {
    console.error('❌ Erro: Template não encontrado!');
    return;
  }

  // Determinar o projeto alvo
  let targetSpaceId = template.space;
  if (projetoAlvoNameOrId) {
    console.log(`🔍 Buscando projeto alvo: "${projetoAlvoNameOrId}"...`);
    const projetos = await readClient.findAll(tracker.class.Project, {
      $or: [{ name: projetoAlvoNameOrId }, { _id: projetoAlvoNameOrId }, { identifier: projetoAlvoNameOrId }]
    });
    if (projetos.length > 0) {
      targetSpaceId = projetos[0]._id;
      console.log(`📍 Projeto selecionado: ${projetos[0].name}`);
    } else {
      console.warn(`⚠️ Projeto "${projetoAlvoNameOrId}" não encontrado. Usando o projeto padrão do template.`);
    }
  }

  // Pegar o status padrão do projeto
  const projeto = await readClient.findOne(tracker.class.Project, { _id: targetSpaceId });
  const statusInicial = projeto?.defaultIssueStatus || (tracker.status as any).Todo;

  console.log(`\n✨ Iniciando onboarding: ${nomeCliente}`);
  console.log(`📋 Template: ${template.title}`);
  console.log(`📂 Projeto: ${projeto?.name || 'Não encontrado'}\n`);

  // 1. Incrementar a sequência do projeto para gerar o ID da tarefa (ex: PROJ-12)
  console.log('🔢 Gerando identificador da tarefa...');
  const incResult = await writeClient.updateDoc(
    tracker.class.Project,
    'space:class:Space' as any, // Espaço global do sistema
    targetSpaceId,
    { $inc: { sequence: 1 } } as any,
    true
  );

  const number = (incResult as any).object.sequence;
  const identifier = `${projeto?.identifier}-${number}`;
  console.log(`🆔 Identificador gerado: ${identifier}`);

  try {
    // 2. Criar Tarefa Principal
    console.log('➕ Criando tarefa principal...');
    const tarefaId = await writeClient.addCollection(
      tracker.class.Issue,
      targetSpaceId,        // Onde ela mora (Projeto)
      'tracker:ids:NoParent' as any, // O PAI de uma tarefa raiz no Huly
      tracker.class.Issue,  // A classe do pai (sempre Issue para a árvore)
      'subIssues',
      {
        title: template.title.replace(/{cliente}/g, nomeCliente),
        identifier: identifier,
        number: number,
        rank: '0|hzzzzz:',     // Rank que vimos na tarefa manual
        description: template.description,
        priority: template.priority,
        status: template.status || 'tracker:status:Todo', // Usa o status do template ou Todo
        kind: (template as any).kind, // COPIAR O KIND É ESSENCIAL
        clientName: nomeCliente,
        clientStage: 'onboarding',
        space: targetSpaceId, // O projeto ao qual ela pertence
        attachedTo: 'tracker:ids:NoParent',
        attachedToClass: tracker.class.Issue,
        collection: 'subIssues',
        template: { template: template._id }
      } as any
    );

    console.log(`✅ Tarefa principal criada: ${tarefaId}`);

    // 3. Criar Subtarefas
    if (template.children && template.children.length > 0) {
      console.log(`\n🛠️ Criando ${template.children.length} subtarefas:`);
      for (const child of template.children) {
        process.stdout.write(`  > ${child.title}... `);

        // Incrementar sequência para cada subtarefa
        const subInc = await writeClient.updateDoc(
          tracker.class.Project,
          'space:class:Space' as any,
          targetSpaceId,
          { $inc: { sequence: 1 } } as any,
          true
        );
        const subNumber = (subInc as any).object.sequence;
        const subIdentifier = `${projeto?.identifier}-${subNumber}`;

        await writeClient.addCollection(
          tracker.class.Issue,
          targetSpaceId,    // Volta para o Espaço do Projeto
          tarefaId,         // ID da tarefa principal (Pai)
          tracker.class.Issue,
          'subIssues',
          {
            title: child.title.replace(/{cliente}/g, nomeCliente),
            identifier: subIdentifier,
            number: subNumber,
            rank: '0|hzzzzz:',
            description: child.description,
            priority: child.priority,
            kind: (child as any).kind, // Copia o tipo da subtarefa do template
            estimation: child.estimation,
            clientName: nomeCliente,
            status: child.status || 'tracker:status:Todo',
            clientStage: 'onboarding',
            space: targetSpaceId
          } as any
        );
        process.stdout.write(`OK (${subIdentifier})\n`);
      }
    }

    console.log(`\n🎉 Onboarding concluído com sucesso para "${nomeCliente}"!`);
  } catch (error: any) {
    console.error('\n❌ Erro durante a execução:');
    console.error(error.message || error);
  }
}

run().catch(console.error);
