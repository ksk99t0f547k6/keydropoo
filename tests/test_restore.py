import importlib.util
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

script = Path(__file__).parents[1] / 'scripts' / 'prepare-restore.py'
spec = importlib.util.spec_from_file_location('prepare_restore', script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RestoreTests(unittest.TestCase):
    def test_forward_reference_and_trigger_preservation(self):
        source = '''PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id), value TEXT);
INSERT INTO child VALUES(1,1,'semi;colon and ''quoted'' text');
CREATE TABLE parent(id INTEGER PRIMARY KEY);
INSERT INTO parent VALUES(1);
CREATE TABLE events(id INTEGER);
CREATE TRIGGER record_child AFTER INSERT ON child BEGIN
 INSERT INTO events VALUES(NEW.id);
 UPDATE child SET value=value||';done' WHERE id=NEW.id;
END;
CREATE VIEW child_view AS SELECT * FROM child;
CREATE UNIQUE INDEX child_parent ON child(parent_id);
'''
        with sqlite3.connect(':memory:') as db:
            db.execute('PRAGMA foreign_keys=ON')
            # D1 匯入在交易內執行；Python executescript 預設逐句提交，需明確模擬交易。
            db.executescript('BEGIN;\n' + module.prepare(source) + '\nCOMMIT;')
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
            self.assertEqual(db.execute('SELECT count(*) FROM events').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT value FROM child_view').fetchone()[0], "semi;colon and 'quoted' text")
            db.execute('INSERT INTO parent VALUES(2)')
            db.execute("INSERT INTO child VALUES(2,2,'new')")
            self.assertEqual(db.execute('SELECT id FROM events').fetchall(), [(2,)])
            self.assertEqual(db.execute('SELECT value FROM child WHERE id=2').fetchone()[0], 'new;done')

    def test_rejects_incomplete_and_unexpected_statements(self):
        for source in ['CREATE TABLE a(id); INSERT INTO a VALUES(', 'CREATE TABLE a(id); DROP TABLE a;', 'PRAGMA foreign_keys=OFF;CREATE TABLE a(id);', '']:
            with self.assertRaises(ValueError):
                module.prepare(source)

    def test_output_is_private_and_existing_file_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            source, target = Path(folder) / 'source.sql', Path(folder) / 'target.sql'
            source.write_text('CREATE TABLE a(id); INSERT INTO a VALUES(1);')
            subprocess.run([sys.executable, str(script), str(source), str(target)], check=True, capture_output=True)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            original = target.read_bytes()
            result = subprocess.run([sys.executable, str(script), str(source), str(target)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(target.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
