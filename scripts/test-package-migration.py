"""Exercise Debian rename metadata in an isolated package database/root.

No host packages or user files are modified, no application/maintainer scripts
are executed. Requires Debian dpkg tools. This is not Linux GUI acceptance.
"""
import json
import pathlib
import shutil
import subprocess
import tempfile


def verify(config):
    if not shutil.which('dpkg-deb') or not shutil.which('dpkg'):
        raise RuntimeError('Debian dpkg tools are required')
    metadata = config['bundle']['linux']['deb']
    if metadata['replaces'] != ['arvela'] or metadata['conflicts'] != ['arvela']:
        raise ValueError('Only the previous application package may be replaced')
    with tempfile.TemporaryDirectory(prefix='enki-package-migration-') as temporary:
        base = pathlib.Path(temporary)
        root = base / 'root'
        root.mkdir()
        sentinel = root / 'home/test/.local/share/opencode-desktop/chats/keep.bin'
        sentinel.parent.mkdir(parents=True)
        sentinel.write_bytes(b'owner data must survive')
        def package(name, version, files, extra=''):
            folder = base / name
            (folder / 'DEBIAN').mkdir(parents=True)
            (folder / 'DEBIAN/control').write_text(
                f'Package: {name}\nVersion: {version}\nArchitecture: all\n'
                'Maintainer: Enki isolated test <test@example.invalid>\n'
                f'Description: Isolated package migration fixture\n{extra}')
            for path, value in files.items():
                target = folder / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(value)
                if path.startswith('usr/bin/'):
                    target.chmod(0o755)
            output = base / (name + '.deb')
            subprocess.run(['dpkg-deb', '--build', str(folder), str(output)], check=True, capture_output=True)
            return output
        old = package('arvela', '0.2.83', {'usr/bin/opencode-desktop':'old', 'usr/share/applications/arvela.desktop':'old'})
        fields = ''.join(k.title() + ': ' + ', '.join(metadata[k]) + '\n' for k in ['conflicts','replaces','provides'])
        new = package('enki', config['version'], {'usr/bin/opencode-desktop':'compat', 'usr/bin/enki':'new', 'usr/share/applications/enki.desktop':'new'}, fields)
        (root/'var/log').mkdir(parents=True,exist_ok=True)
        for archive in [old, new]:
            subprocess.run(['dpkg', '--root='+str(root), '--admindir='+str(root/'var/lib/dpkg'), '--log='+str(root/'var/log/dpkg.log'), '--force-not-root', '--install', str(archive)], check=True, capture_output=True)
        assert (root/'usr/bin/enki').read_text() == 'new'
        assert (root/'usr/bin/opencode-desktop').read_text() == 'compat'
        assert not (root/'usr/share/applications/arvela.desktop').exists()
        assert sentinel.read_bytes() == b'owner data must survive'
        query = subprocess.run(['dpkg-query','--admindir='+str(root/'var/lib/dpkg'),'-W','-f=${Package} ${Status}\n'],check=True,capture_output=True,text=True).stdout
        assert 'enki install ok installed' in query and 'arvela install ok installed' not in query
    print('ISOLATED_DPKG_RENAME_FILES_AND_USER_DATA_PASS')


if __name__ == '__main__':
    import sys
    # stdin supports a bounded remote fixture run without deploying the repo.
    config = json.load(sys.stdin) if '--stdin' in sys.argv else json.loads((pathlib.Path(__file__).resolve().parents[1]/'src-tauri/tauri.conf.json').read_text())
    verify(config)
