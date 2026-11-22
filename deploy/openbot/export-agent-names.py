#!/usr/bin/env python3
"""Exporta id -> nome dos agentes do OpenBot para o JSON que o Habblaud lê (HABBLAUD_AGENT_NAMES_FILE).

Só lê o banco do OpenBot (sqlite3 em modo somente leitura) e grava só `id -> nome`. A escrita é atômica: se algo
falhar, sai com código 1 e o arquivo anterior fica como está.
"""
import argparse
import datetime
import json
import os
import re
import sqlite3
import sys
import tempfile

DEFAULT_DB = '/data/.config/OpenBot/openbot.db'
DEFAULT_OUT = '/data/OpenBot/Shared/escritorio-virtual/agent-names.json'
QUERY = "SELECT agent_id, json_extract(agent_json, '$.name') FROM projection_agents"
NAME_MAX = 80
CONTROL = re.compile(r'[\x00-\x1f\x7f]')


class ExportError(Exception):
    pass


def read_names(db_path):
    if not os.path.exists(db_path):
        raise ExportError(f'banco não encontrado: {db_path}')
    try:
        con = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=5)
        try:
            rows = con.execute(QUERY).fetchall()
        finally:
            con.close()
    except sqlite3.Error as err:
        raise ExportError(f'não consegui ler projection_agents: {err}') from err
    agents = {}
    for agent_id, name in rows:
        if not isinstance(agent_id, str) or not isinstance(name, str):
            continue
        # Segunda barreira (o Habblaud valida de novo): sem controle, espaços colapsados, no máximo NAME_MAX caracteres.
        clean = ' '.join(CONTROL.sub(' ', name).split())[:NAME_MAX].strip()
        if clean:
            agents[agent_id] = clean
    if not agents:
        raise ExportError('nenhum agente com nome no banco; mantive o arquivo anterior')
    return agents


def write_atomic(out_path, agents):
    payload = {
        'version': 1,
        'generatedAt': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'agents': agents,
    }
    folder = os.path.dirname(os.path.abspath(out_path))
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix='.agent-names-', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
            f.write('\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, out_path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def export(db_path, out_path):
    agents = read_names(db_path)
    write_atomic(out_path, agents)
    return len(agents)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--db', default=DEFAULT_DB, help='banco do OpenBot (somente leitura)')
    parser.add_argument('--out', default=DEFAULT_OUT, help='JSON de saída (HABBLAUD_AGENT_NAMES_FILE)')
    args = parser.parse_args(argv)
    try:
        count = export(args.db, args.out)
    except (ExportError, OSError) as err:
        print(f'export-agent-names: {err}', file=sys.stderr)
        return 1
    print(f'export-agent-names: {count} agente(s) em {args.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
