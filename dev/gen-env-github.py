#!/usr/bin/env python3
"""Gera dev/.env.github a partir de dev/.env.secrets."""
import re, os

script_dir = os.path.dirname(os.path.abspath(__file__))
secrets_path = os.path.join(script_dir, '.env.secrets')
github_path  = os.path.join(script_dir, '.env.github')

with open(secrets_path) as f:
    raw = f.read()

def extract(raw, key):
    m = re.search(rf'^{key}="([\s\S]*?)"', raw, re.MULTILINE)
    if m: return m.group(1)
    m = re.search(rf"^{key}='([\s\S]*?)'", raw, re.MULTILINE)
    if m: return m.group(1)
    m = re.search(rf'^{key}=(.+)', raw, re.MULTILINE)
    if m: return m.group(1).strip()
    return ''

app_id     = extract(raw, 'APP_ID') or '3772028'
client_id  = extract(raw, 'CLIENT_ID') or 'Iv23liz1iroLtzYJl96V'
client_sec = extract(raw, 'CLIENT_SECRET')
webhook    = extract(raw, 'WEBHOOK_SECRET') or 'secret'
pkey       = extract(raw, 'PRIVATE_KEY') or extract(raw, 'GITHUB_PRIVATE_KEY')
pkey       = pkey.replace('\n', '\\n')

with open(github_path, 'w') as f:
    f.write(f'APP_ID={app_id}\n')
    f.write(f'CLIENT_ID={client_id}\n')
    f.write(f'CLIENT_SECRET={client_sec}\n')
    f.write(f'WEBHOOK_SECRET={webhook}\n')
    f.write(f'PRIVATE_KEY={pkey}\n')

print(f'Criado: {github_path}')
print(f'  APP_ID={app_id}')
print(f'  CLIENT_ID={client_id}')
print(f'  CLIENT_SECRET={"*" * len(client_sec)}')
print(f'  PRIVATE_KEY={"ok (" + str(len(pkey)) + " chars)" if pkey else "FALTANDO"}')
