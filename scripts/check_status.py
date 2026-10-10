import urllib.request
import json
import ssl

with open('.env.local', 'r', encoding='utf-8') as f:
    env = {}
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"\'')

url = env.get('NEXT_PUBLIC_SUPABASE_URL', '')
key = env.get('SUPABASE_SECRET_KEY', '')

if not url or not key:
    print("Supabase credentials not found in .env.local")
    exit(1)

req = urllib.request.Request(
    f"{url}/rest/v1/audit_results?order=created_at.desc&limit=5",
    headers={'apikey': key, 'Authorization': f'Bearer {key}'}
)
ctx = ssl.create_default_context()
try:
    resp = urllib.request.urlopen(req, context=ctx)
    records = json.loads(resp.read().decode('utf-8'))
    print(f"Found {len(records)} recent audit records:")
    for r in records:
        print(f"ID: {r.get('document_id')} | Status: {r.get('status')} | Backend: {r.get('backend')} | Created: {r.get('created_at')}")
except Exception as e:
    print("Error:", e)

