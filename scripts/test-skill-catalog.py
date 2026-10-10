#!/usr/bin/env python3
import importlib.util
import json
import sys
sys.dont_write_bytecode = True
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / 'src-tauri/resources/skills/create-shared-skill/scripts/catalog.py'
spec = importlib.util.spec_from_file_location('catalog', SOURCE)
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)

class Catalogue(unittest.TestCase):
    def test_scope_override_disabled_and_no_server_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); project = root / 'project'; project.mkdir()
            (root/'global.json').write_text(json.dumps({'version':1,'sources':[{'id':'same','path':str(root/'global'),'enabled':True},{'id':'enabled','path':str(root/'common'),'enabled':True}], 'servers':[{'secret':'MUST_NOT_EMIT'}]}))
            (root/(catalog.project_key(project)+'.json')).write_text(json.dumps({'version':1,'sources':[{'id':'same','path':str(root/'override'),'enabled':False}]}))
            self.assertEqual(catalog.registry_sources(root,project),[root/'common'])
    def test_identity_revision_and_dedup_without_executing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); skill = root/'download'; skill.mkdir()
            file = skill/'SKILL.md'; file.write_text('---\nname: download\ndescription: Fetch public documents\n---\nBody\n')
            (skill/'scripts').mkdir(); (skill/'scripts/unsafe.py').write_text('raise Exception("must not execute")')
            records = catalog.inventory([root,root]); self.assertEqual(len(records),1)
            self.assertEqual(records[0]['name'],'download'); self.assertEqual(records[0]['path'],str(file.resolve()))
            old = records[0]['sha256']; file.write_text(file.read_text()+'Fix\n')
            self.assertNotEqual(catalog.inventory([root])[0]['sha256'],old)
    def test_invalid_registry_is_explicit_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root/'global.json').write_text('{broken')
            with self.assertRaises(ValueError): catalog.registry_sources(root,None)

if __name__ == '__main__': unittest.main()
