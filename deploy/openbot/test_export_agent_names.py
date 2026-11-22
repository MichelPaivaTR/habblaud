"""Testes do exportador de nomes, com um SQLite temporário (o banco real não é tocado).

Rodar: python3 -m unittest discover -s deploy/openbot -p 'test_*.py'
"""
import importlib.util
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('export_agent_names', HERE / 'export-agent-names.py')
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)

ID_A = 'agent-3d36e8ea-5d84-4d50-9be7-d88973e927bc'
ID_B = 'agent-612a1598-1dd9-40f4-a7a2-be2eb4f7c5ba'


def make_db(path, rows):
    con = sqlite3.connect(path)
    con.execute(
        'CREATE TABLE projection_agents (agent_id TEXT PRIMARY KEY, thread_id TEXT, model TEXT NOT NULL, updated_at TEXT, '
        'sort_order INTEGER NOT NULL, agent_json TEXT NOT NULL, last_event_sequence INTEGER NOT NULL)'
    )
    for i, (agent_id, agent_json) in enumerate(rows):
        con.execute(
            'INSERT INTO projection_agents VALUES (?, NULL, ?, NULL, ?, ?, ?)',
            (agent_id, 'modelo', i, json.dumps(agent_json), i),
        )
    con.commit()
    con.close()


class ExportAgentNamesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.db = str(self.dir / 'openbot.db')
        self.out = str(self.dir / 'agent-names.json')

    def tearDown(self):
        self.tmp.cleanup()

    def test_gera_id_para_nome_e_so_essas_chaves(self):
        make_db(self.db, [
            (ID_A, {'name': 'Faísca', 'title': 'Tech Lead', 'workspacePath': '/x', 'access': {'token': 'segredo'}}),
            (ID_B, {'name': '  Rampa  '}),
        ])
        self.assertEqual(exporter.main(['--db', self.db, '--out', self.out]), 0)
        data = json.loads(Path(self.out).read_text(encoding='utf-8'))
        self.assertEqual(set(data), {'version', 'generatedAt', 'agents'})
        self.assertEqual(data['version'], 1)
        self.assertEqual(data['agents'], {ID_A: 'Faísca', ID_B: 'Rampa'})
        self.assertNotIn('segredo', Path(self.out).read_text(encoding='utf-8'))

    def test_ignora_linhas_sem_nome(self):
        make_db(self.db, [
            (ID_A, {'name': 'Faísca'}),
            (ID_B, {'title': 'sem nome'}),
            ('agent-x', {'name': '   '}),
        ])
        self.assertEqual(exporter.main(['--db', self.db, '--out', self.out]), 0)
        self.assertEqual(json.loads(Path(self.out).read_text(encoding='utf-8'))['agents'], {ID_A: 'Faísca'})

    def test_banco_ausente_sai_com_erro_e_nao_apaga_o_anterior(self):
        Path(self.out).write_text('{"version":1,"agents":{"x":"antigo"}}', encoding='utf-8')
        self.assertEqual(exporter.main(['--db', str(self.dir / 'nao-existe.db'), '--out', self.out]), 1)
        self.assertIn('antigo', Path(self.out).read_text(encoding='utf-8'))

    def test_esquema_errado_sai_com_erro_e_nao_apaga_o_anterior(self):
        con = sqlite3.connect(self.db)
        con.execute('CREATE TABLE outra (x TEXT)')
        con.commit()
        con.close()
        Path(self.out).write_text('{"version":1,"agents":{"x":"antigo"}}', encoding='utf-8')
        self.assertEqual(exporter.main(['--db', self.db, '--out', self.out]), 1)
        self.assertIn('antigo', Path(self.out).read_text(encoding='utf-8'))

    def test_tabela_vazia_sai_com_erro_e_nao_apaga_o_anterior(self):
        make_db(self.db, [])
        Path(self.out).write_text('{"version":1,"agents":{"x":"antigo"}}', encoding='utf-8')
        self.assertEqual(exporter.main(['--db', self.db, '--out', self.out]), 1)
        self.assertIn('antigo', Path(self.out).read_text(encoding='utf-8'))

    def test_nao_deixa_arquivo_temporario_nem_altera_o_banco(self):
        make_db(self.db, [(ID_A, {'name': 'Faísca'})])
        before = Path(self.db).read_bytes()
        self.assertEqual(exporter.main(['--db', self.db, '--out', self.out]), 0)
        self.assertFalse(os.path.exists(self.out + '.tmp'))
        self.assertEqual(Path(self.db).read_bytes(), before)

    def test_substitui_o_arquivo_quando_os_nomes_mudam(self):
        make_db(self.db, [(ID_A, {'name': 'Faísca'})])
        exporter.main(['--db', self.db, '--out', self.out])
        con = sqlite3.connect(self.db)
        con.execute('UPDATE projection_agents SET agent_json = ? WHERE agent_id = ?', (json.dumps({'name': 'Faísca Nova'}), ID_A))
        con.commit()
        con.close()
        self.assertEqual(exporter.main(['--db', self.db, '--out', self.out]), 0)
        self.assertEqual(json.loads(Path(self.out).read_text(encoding='utf-8'))['agents'], {ID_A: 'Faísca Nova'})


if __name__ == '__main__':
    unittest.main()
