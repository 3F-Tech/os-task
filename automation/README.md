# 🚀 3F Hub - Automação de Onboarding

Este utilitário permite automatizar a criação de fluxos de trabalho (tarefas e subtarefas) para novos clientes no 3F Hub, utilizando templates pré-definidos e garantindo visibilidade total na interface (UI).

## 🛠️ Ferramentas Disponíveis

| Comando | Descrição |
| :--- | :--- |
| `npm run onboard` | Dispara o onboarding de um cliente (Cria tarefa + subtarefas). |
| `npm run list-templates` | Lista todos os templates de tarefas disponíveis no sistema. |
| `npm run get-id` | Extrai o seu Workspace ID e Account ID a partir do Token. |
| `npm run debug-task` | Gera um Raio-X (JSON) das últimas tarefas (Útil para suporte). |

## ⚙️ Configuração Inicial

1.  Entre na pasta `automation`.
2.  Crie um arquivo `.env` baseado no `.env.example`.
3.  Preencha o `HUB_API_TOKEN` (Gerado em *Settings -> General -> API Access*).
4.  O `HUB_WORKSPACE_ID` é opcional; o script tentará extraí-lo automaticamente do seu Token.

## 🚀 Como usar o Onboarding

O comando principal aceita três argumentos, sendo o último opcional:

```bash
npm run onboard -- "NOME DO CLIENTE" "NOME DO TEMPLATE" ["NOME DO PROJETO"]
```

### Exemplos:
- **Usando o projeto padrão do template:**
  `npm run onboard -- "Empresa ABC" "Onboarding Padrao"`
- **Forçando um projeto específico:**
  `npm run onboard -- "Empresa ABC" "Onboarding Padrao" "Comercial"`

## 💡 Recursos Avançados

### 1. Variáveis no Template
Você pode usar a tag `{cliente}` nos títulos das tarefas dentro do Huly (Interface). O script substituirá automaticamente:
- Título no Template: `Reunião Kick-off: {cliente}`
- Resultado Final: `Reunião Kick-off: Empresa ABC`

### 2. Visibilidade Automática na UI
O script cuida de toda a "burocracia" do Huly para que a tarefa apareça no Board e nas listas:
- Gera Identificadores sequenciais (ex: `PROJ-101`).
- Define o `Status` como "Todo" (A Fazer) para evitar que as tarefas fiquem presas no Backlog.
- Configura o `Rank` para ordenação correta.
- Vincula o `Kind` (Tipo) da tarefa conforme definido no template.

## 🔒 Segurança

- **Arquivos Secretos**: Nunca commite o arquivo `.env`. Ele já está no `.gitignore` desta pasta.
- **Repositório Separado**: Você pode mover esta pasta para um repositório Git independente. Se fizer isso, lembre-se de instalar as dependências (`npm install`) e garantir que a URL do Transactor esteja acessível.
