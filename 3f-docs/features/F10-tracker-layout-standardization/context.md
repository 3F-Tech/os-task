# Contexto: Padronização do Layout do Tracker

## Problema
A visualização de lista do Huly Tracker apresentava um layout inconsistente para colunas de metadados. As colunas (Cliente, Etapa, Tempo, etc.) tinham larguras variáveis que dependiam do conteúdo, tornando impossível ter um cabeçalho estático e alinhado. Isso dificultava a leitura rápida de grandes volumes de tarefas e não transmitia a robustez visual esperada de uma ferramenta profissional (estilo ClickUp).

## Objetivo
Implementar um cabeçalho fixo com colunas perfeitamente alinhadas às células das tarefas, garantindo que metadados críticos estejam sempre na mesma posição horizontal, independente do conteúdo ou do tamanho da tela.

## Requisitos
- Alinhamento pixel-perfect entre cabeçalho e linhas.
- Suporte a colunas agrupadas (normais na esquerda, datas na direita).
- Persistência das larguras mesmo após redimensionamento ou recarregamento.
