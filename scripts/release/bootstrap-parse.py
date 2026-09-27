"""Contrôle syntaxique PostgreSQL local ; aucune connexion ni exécution SQL."""
import hashlib
import json
import re
from pathlib import Path

import pglast
from pglast import parse_sql


ROOT = Path(__file__).resolve().parents[2]
FOLDER = ROOT / '.release-manifests' / 'v3-bootstrap'


def candidate(text):
    match = re.search(r'SELECT (\$[a-z_]+\$)\n', text)
    if not match:
        raise ValueError('Enveloppe de revue absente')
    parts = text.split(match.group(1))
    if len(parts) != 3 or parts[2] != ' AS unapproved_sql;\n':
        raise ValueError('Enveloppe de revue invalide')
    return parts[1]


def main():
    results = []
    for name in ('schema-review.sql', 'reference-data-review.sql', 'post-init-readonly.sql'):
        raw = (FOLDER / name).read_bytes()
        text = raw.decode('utf-8')
        parse_sql(text)
        sql = candidate(text) if name != 'post-init-readonly.sql' else text
        statements = parse_sql(sql)
        results.append({'file': name, 'sha256': hashlib.sha256(raw).hexdigest(),
                        'statements': len(statements), 'syntax_valid': True})
    proof = {'parser': f'pglast {pglast.__version__}', 'database_execution': False,
             'scope': 'Syntaxe PostgreSQL ; ne résout ni les objets ni les dépendances et ne remplace pas une restauration.',
             'files': results}
    (FOLDER / 'sql-parse-validation.json').write_text(json.dumps(proof, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(proof, indent=2))


if __name__ == '__main__':
    main()
