# 3F Docs — Documentação Interna do 3F Tasks

Documentação das features customizadas desenvolvidas no fork do 3F Tasks (baseado em Huly) para uso interno da 3F Venture.

## Estrutura

```
3f-docs/
  features/
    F01-issue-completion-validation/
      context.md   ← arquitetura, decisões, limitações
      tests.md     ← casos de teste manuais
    F02-tag-based-sharing/
      context.md
      tests.md
```

## Features

| ID | Nome | Branch | Status |
|---|---|---|---|
| F01 | Validação de Conclusão de Issue | `feature/issue-completion-validation` | ✅ Implementada |
| F02 | Compartilhamento por Tags | `feature/tag-based-sharing` | ✅ Implementada |
| F03 | Datas Automáticas (start + finalização) | `feature/automatic-dates` | 🔲 A desenvolver |
| F04 | Ciclo PDCA | `feature/pdca-cycle` | ✅ Implementada (pod `worker`) |
| F05 | Onboarding Automático de Cliente | `feature/auto-client-onboarding` | 🔲 A desenvolver |
| F06 | Sistema de BUs e Controle de Acesso | `feature/bu-access-control` | 🔲 A desenvolver |
| F07 | Custom Fields na List View | `feature/custom-fields-list-view` | 🔲 A desenvolver |
| F08 | Home Dashboard | `feature/home-dashboard` | 🔲 A desenvolver |
| F09 | Campos de Cliente (Nome do Cliente + Etapa) | `feature/client-fields` | ✅ Implementada |
| F10 | Dashboard Operacional | `feature/operational-dashboard` | ⛔ Descontinuado no 3F Tasks (migrado p/ outro sistema) |
| F11 | Login Universal (3F Core) | `feat/universal-login-3fcore` | ✅ Implementada — EM PRODUÇÃO |
