"""Read-only full-tree privacy inventory. Findings contain hashes, never values."""
import argparse
import hashlib
import json
import os
import re
import struct
import sys
import zipfile
import io
from pathlib import Path

TOKEN = re.compile(rb'(?P<private_key>-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----)|(?P<provider_token>\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{30,255}|sk-(?:proj-|ant-|svcacct-)?[A-Za-z0-9_-]{20,255}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35}|xox[baprs]-[A-Za-z0-9-]{10,200}|(?:sk|rk)_live_[A-Za-z0-9]{16,200}))\b|(?P<jwt>\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})')
PREFIXES = (b'-----BEGIN ', b'ghp_', b'gho_', b'ghu_', b'ghs_', b'ghr_', b'github_pat_', b'sk-', b'AKIA', b'ASIA', b'AIza', b'xoxb-', b'xoxa-', b'xoxp-', b'xoxr-', b'xoxs-', b'rk_live_', b'eyJ')
HOME = re.compile(r'(?:[A-Z]:[\\/]+Users[\\/]+(?!Public\b|Default\b|user\b|username\b|example\b|test\b)[^\\/\s"\x27<>]+|/(?:home|Users)/(?!shared\b|user\b|username\b|example\b|test\b)[^/\s"\x27<>]+)', re.I)
ABSOLUTE = re.compile(r'(?<![\w])(?:[A-Z]:[\\/]+(?![bnrstwd]\b)[^\s"\x27<>|?*\x00]{2,180}|/(?:home|Users)/[^\s"\x27<>]{2,180})', re.I)
EMAIL = re.compile(r'(?<![\w.+-])[A-Z0-9_.+-]{1,64}@[A-Z0-9.-]+\.[A-Z]{2,20}\b', re.I)
IMAGE = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.svg', '.bmp', '.tif', '.tiff', '.avif'}

def sha(data):
    return hashlib.sha256(data).hexdigest()

def linked(p):
    return p.is_symlink() or bool(getattr(p.lstat(), 'st_file_attributes', 0) & 0x400)

def token_hits(data):
    hits = {}
    for prefix in PREFIXES:
        pos = 0
        while True:
            pos = data.find(prefix, pos)
            if pos < 0:
                break
            start = max(0, pos - 1)
            for m in TOKEN.finditer(data[start:pos + 1600]):
                if start + m.start() == pos:
                    hits[(m.lastgroup.replace('_', '-'), pos, sha(m.group()))] = None
            pos += len(prefix)
    return [{'rule': rule, 'offset': pos, 'matchSha256': digest} for rule, pos, digest in hits]

def content_findings(data):
    hits = token_hits(data)
    try:
        if data.startswith((b'\xff\xfe', b'\xfe\xff')):
            text = data.decode('utf-16')
        elif b'\0' in data[:16384]:
            return hits, False
        else:
            text = data.decode('utf-8-sig')
    except UnicodeError:
        return hits, False
    for hit in hits:
        hit['line'] = data.count(b'\n', 0, hit['offset']) + 1
    if text.lstrip().startswith('{'):
        try:
            value = json.loads(text)
            if isinstance(value, dict) and (value.get('format') == 'lvx-workspace' or isinstance(value.get('exported_at'), str) and any(isinstance(value.get(k), list) for k in ('test_suites', 'pipelines'))):
                hits.append({'rule': 'portable-project-save', 'matchSha256': sha(data)})
        except (ValueError, TypeError):
            pass
    text = re.sub(r'\\u([a-f0-9]{4})', lambda m: chr(int(m[1], 16)), text, flags=re.I)
    for _ in range(3):
        text = text.replace('\\\\', '\\')
    for rule, pattern in (('personal-home-path', HOME), ('absolute-path', ABSOLUTE), ('email-address', EMAIL)):
        for m in pattern.finditer(text):
            if rule == 'email-address':
                domain = m.group().rsplit('@', 1)[1].lower()
                if domain in ('example.com', 'example.org', 'example.net', 'test.com') or domain.endswith(('.example', '.test', '.invalid')):
                    continue
            hits.append({'rule': rule, 'line': text.count('\n', 0, m.start()) + 1, 'matchSha256': sha(m.group().encode())})
    return hits, True

def run(scan_root, repo, snapshot=False):
    records, findings, errors, archives = [], [], [], []
    cache, archive_cache = {}, set()
    def examine(data, name, outer_hash, depth=0):
        digest = sha(data)
        if digest not in cache:
            cache[digest] = content_findings(data)
        hits, text = cache[digest]
        findings.extend(dict(hit, file=name, outerSha256=outer_hash) for hit in hits)
        suffix = Path(name).suffix.lower()
        if suffix not in ('.zip', '.whl', '.asar') or digest in archive_cache:
            return text
        if depth >= 3:
            errors.append({'file': name, 'reason': 'archive-depth-limit'})
            return text
        archive_cache.add(digest)
        try:
            if suffix == '.asar':
                header_size, json_size = struct.unpack_from('<I', data, 4)[0], struct.unpack_from('<I', data, 12)[0]
                tree = json.loads(data[16:16 + json_size])
                count = 0
                def visit(node, parts=()):
                    nonlocal count
                    for key, value in node.get('files', {}).items():
                        parts2 = parts + (key,)
                        if 'files' in value:
                            visit(value, parts2)
                        elif 'offset' in value and 'size' in value:
                            start = 8 + header_size + int(value['offset'])
                            member = data[start:start + value['size']]
                            if len(member) != value['size']:
                                raise ValueError('asar-size')
                            examine(member, name + '!' + '/'.join(parts2), outer_hash, depth + 1)
                            count += 1
                        elif not value.get('unpacked'):
                            raise ValueError('asar-link-or-unknown-entry')
                visit(tree)
            else:
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    members = [m for m in archive.infolist() if not m.is_dir()]
                    count = len(members)
                    for member in members:
                        if member.flag_bits & 1:
                            raise ValueError('encrypted-archive')
                        examine(archive.read(member), name + '!' + member.filename, outer_hash, depth + 1)
            archives.append({'file': name, 'members': count})
        except Exception as error:
            errors.append({'file': name, 'reason': type(error).__name__})
        return text
    def walk_error(error):
        errors.append({'file': '<directory>', 'reason': type(error).__name__})
    for base, dirs, names in os.walk(scan_root, followlinks=False, onerror=walk_error):
        for directory in list(dirs):
            p = Path(base) / directory
            if directory == '.git':
                dirs.remove(directory)
            elif linked(p):
                errors.append({'file': p.relative_to(scan_root).as_posix(), 'reason': 'external-link-not-followed'})
                dirs.remove(directory)
        for name in sorted(names):
            p = Path(base) / name
            if name == '.git':
                continue
            relative = p.relative_to(scan_root).as_posix()
            try:
                if linked(p):
                    raise ValueError('link-not-followed')
                before = p.stat()
                data = p.read_bytes()
                after = p.stat()
                if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                    raise ValueError('file-changed-during-read')
                digest = sha(data)
                entry = {'file': relative, 'sha256': digest, 'bytes': len(data)}
                try:
                    entry['repoFile'] = p.relative_to(repo).as_posix()
                except ValueError:
                    entry['repoFile'] = None
                if not snapshot:
                    entry['text'] = examine(data, relative, digest)
                    entry['image'] = p.suffix.lower() in IMAGE
                    if p.suffix.lower() in ('.key', '.pem', '.pfx', '.p12', '.ppk', '.jks'):
                        findings.append({'file': relative, 'rule': 'private-key-file', 'outerSha256': digest})
                records.append(entry)
            except Exception as error:
                errors.append({'file': relative, 'reason': type(error).__name__})
    records.sort(key=lambda f: f['file'])
    canonical = [[f['file'], f['sha256']] for f in records]
    fingerprint = sha(json.dumps(canonical, ensure_ascii=True, separators=(',', ':')).encode())
    return {'files': records, 'treeDigest': fingerprint, 'findings': findings, 'archives': archives, 'errors': errors}

def selftest():
    key = b'ghp_' + b'A' * 36
    assert token_hits(b'\0' + key + b'\0')
    assert not token_hits(b'\0ordinary control\0')
    assert any(f['rule'] == 'personal-home-path' for f in content_findings(('/'.join(('C:', 'Users', 'private-owner', 'project'))).encode())[0])
    assert any(f['rule'] == 'email-address' for f in content_findings(('person' + '@' + 'private-company.example.org').encode())[0])
    assert not content_findings(b'portable workspace-relative paths')[0]

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--report', required=True)
    parser.add_argument('--snapshot', action='store_true')
    args = parser.parse_args()
    selftest()
    scan_root, repo = Path(args.root).resolve(), Path(args.repo).resolve()
    if scan_root not in (repo, repo.parent) or scan_root == Path(scan_root.anchor):
        raise ValueError('Unbound scan root')
    result = run(scan_root, repo, args.snapshot)
    Path(args.report).write_text(json.dumps(result, ensure_ascii=True, indent=2), encoding='utf-8')
    print('LVX_FULL_TREE_INVENTORIED', len(result['files']), len(result['errors']))
    sys.exit(1 if result['errors'] else 0)
