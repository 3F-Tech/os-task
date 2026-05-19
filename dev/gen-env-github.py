#!/usr/bin/env python3
"""Gera dev/.env.github a partir de dev/.env.secrets."""
import re, os

script_dir = os.path.dirname(os.path.abspath(__file__))
secrets_path = os.path.join(script_dir, '.env.secrets')
github_path  = os.path.join(script_dir, '.env.github')

with open(secrets_path) as f:
    raw = f.read()

def extract_simple(raw, key):
    """Extrai valor sem quotes, linha única."""
    m = re.search(rf'^{key}=([^\n]+)', raw, re.MULTILINE)
    if not m:
        return ''
    val = m.group(1).strip()
    # Remove aspas envolventes (simples ou duplas)
    if len(val) >= 2 and val[0] in ('"', "'") and val[-1] == val[0]:
        val = val[1:-1]
    return val

def extract_private_key(raw):
    """Extrai chave privada (pode estar em formato multilinha com \\, ou linha única com \\n)."""
    for key in ('PRIVATE_KEY', 'GITHUB_PRIVATE_KEY'):
        # Tenta encontrar valor após key=
        m = re.search(rf'^{key}=(.+?)(?:\n[A-Z_]|\Z)', raw, re.MULTILINE | re.DOTALL)
        if not m:
            continue
        val = m.group(1)
        # Remove aspa de abertura/fechamento se existir
        val = val.strip()
        if val.startswith('"') or val.startswith("'"):
            val = val[1:]
        if val.endswith('"') or val.endswith("'"):
            val = val[:-1]
        # Junta linhas que terminam com \ (continuação) e converte newlines reais em \n literal
        lines = val.split('\n')
        joined = []
        for line in lines:
            line = line.strip()
            if line.endswith('\\'):
                joined.append(line[:-1])
            else:
                joined.append(line)
        val = ''.join(joined)
        # Garante que \n são literais (não newlines reais residuais)
        val = val.replace('\n', '\\n')
        if val:
            return val
    return ''

app_id     = extract_simple(raw, 'APP_ID') or '3772028'
client_id  = extract_simple(raw, 'CLIENT_ID') or 'Iv23liz1iroLtzYJl96V'
client_sec = extract_simple(raw, 'CLIENT_SECRET')
webhook    = extract_simple(raw, 'WEBHOOK_SECRET') or 'secret'
pkey       = extract_private_key(raw)

print(f'  APP_ID={app_id}')
print(f'  CLIENT_ID={client_id}')
print(f'  CLIENT_SECRET={"*" * len(client_sec) if client_sec else "<VAZIO — precisa preencher>"}')
print(f'  PRIVATE_KEY={"ok (" + str(len(pkey)) + " chars)" if len(pkey) > 200 else "<CURTO/FALTANDO: " + str(len(pkey)) + " chars>"}')

if not pkey or len(pkey) < 200:
    print()
    print('ERRO: PRIVATE_KEY nao encontrada ou truncada em .env.secrets.')
    print('Baixe uma nova chave em: https://github.com/settings/apps/os-tasks')
    print('Depois rode: awk \'NF {sub(/\\r/, ""); printf "%s\\\\n",$0;}\' chave.pem')
    print('E cole o resultado em .env.secrets como:')
    print('  PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\\nMIIE...\\n-----END RSA PRIVATE KEY-----')
    exit(1)

with open(github_path, 'w') as f:
    f.write(f'APP_ID={app_id}\n')
    f.write(f'CLIENT_ID={client_id}\n')
    f.write(f'CLIENT_SECRET={client_sec}\n')
    f.write(f'WEBHOOK_SECRET={webhook}\n')
    f.write(f'PRIVATE_KEY={pkey}\n')

print(f'\nCriado: {github_path}')
