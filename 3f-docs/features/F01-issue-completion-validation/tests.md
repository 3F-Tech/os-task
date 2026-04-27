# Testes — F01: Validação de Conclusão de Issue

> **Ambiente:** http://localhost:7000  
> **Papel necessário:** Owner ou Maintainer para configurar regras; qualquer papel para testar o bloqueio  
> **Pré-requisito:** Pelo menos um projeto criado no Tracker

---

## TC-F01-01 — Configurar regras de conclusão em um projeto

**Caminho:** Settings → Tracker → [Projeto] → Completion Rules

**Passos:**
1. Acesse as configurações do workspace (ícone de engrenagem, canto inferior esquerdo)
2. Navegue até **Tracker** na barra lateral
3. Selecione um projeto existente
4. Clique na aba **Completion Rules**
5. Confirme que existem duas seções: **Issue Completion Rules** e **Subtask Completion Rules**
6. Ative o toggle **Spent time must be logged**
7. Ative o toggle **Estimation must be filled**
8. Feche as configurações

**Resultado esperado:**
- Toggles salvam automaticamente (sem botão "Salvar" explícito)
- Ao reabrir a tela, as regras ativadas continuam marcadas

---

## TC-F01-02 — Bloqueio ao tentar concluir issue sem cumprir regras

**Pré-requisito:** TC-F01-01 executado com `Spent time` e `Estimation` ativos.

**Passos:**
1. Abra o projeto configurado no TC-F01-01
2. Crie uma issue nova sem preencher `Estimation` e sem lançar `Spent time`
3. Tente mudar o status para o status de conclusão do projeto (ex: "FINALIZADO", "RESOLVIDO", "CONCLUÍDO")

**Resultado esperado:**
- O status **não muda**
- Um popup aparece com o título **"Cannot mark as done"**
- O popup lista as regras violadas:
  - "Spent time must be logged"
  - "Estimation must be filled"
- Dois botões visíveis: **"Configure completion rules"** e **"Close"**

---

## TC-F01-03 — Marcar issue como concluída com todas as regras atendidas

**Pré-requisito:** TC-F01-01 executado.

**Passos:**
1. Abra uma issue no projeto configurado
2. Preencha o campo **Estimation** com qualquer valor (ex: `2h`)
3. Lance tempo em **Spent time** com qualquer valor (ex: `1h`)
4. Mude o status para o status de conclusão

**Resultado esperado:** Status muda normalmente, sem popup de bloqueio.

---

## TC-F01-04 — Regra "All subtasks must be completed"

**Passos:**
1. Nas configurações do projeto, ative **All subtasks must be completed** em **Issue Completion Rules**
2. Crie uma issue com pelo menos uma sub-issue aberta
3. Tente marcar a issue **pai** como concluída

**Resultado esperado:** Popup bloqueia com "All subtasks must be completed".

4. Marque a sub-issue como concluída
5. Tente marcar a issue pai novamente

**Resultado esperado:** Status muda sem bloqueio.

---

## TC-F01-05 — Regras independentes para Sub-Issues vs Issues

**Passos:**
1. Nas configurações:
   - **Issue Completion Rules:** sem regras ativas
   - **Subtask Completion Rules:** ative `Spent time must be logged`
2. Tente marcar uma **issue pai** como concluída (sem `Spent time`)

**Resultado esperado:** Issue pai conclui normalmente (sem regras para issues).

3. Tente marcar uma **sub-issue** como concluída (sem `Spent time`)

**Resultado esperado:** Popup bloqueia com a regra violada.

---

## TC-F01-06 — Botão "Configure completion rules" no popup

**Passos:**
1. Reproduza o bloqueio (TC-F01-02)
2. No popup, clique em **"Configure completion rules"**

**Resultado esperado:** Navegação para a tela de configuração de regras do projeto correspondente.

---

## TC-F01-07 — Projeto sem mixin configurado não é bloqueado

**Passos:**
1. Use um projeto que **nunca** teve regras configuradas
2. Crie uma issue sem `Estimation` e sem `Spent time`
3. Tente marcar como concluída

**Resultado esperado:** Status muda normalmente — projeto sem `IssueCompletionConfig` não tem restrições.
