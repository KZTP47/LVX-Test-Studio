"""Package only the user-facing lab; never include app profiles or auth caches."""
import hashlib,json,zipfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
bundle=root/'exports'/'LVX-Advanced-Showcase-2026-10-25'
excluded={'node_modules','bin','obj','__pycache__','.pytest_cache','build-profile','headless-profile','.studio-profile'}
def files():
    result=[]
    def walk(directory):
        for item in directory.iterdir():
            if item.is_symlink() or item.is_junction(): continue
            if item.is_dir():
                if item.name not in excluded and not item.name.startswith(('build-profile-','.verify-')):walk(item)
            elif item.suffix!='.log' and item.name not in {'CHECKSUMS.sha256','delivery-results.json','relocation-results.json','showcase-independent-review.json'}:result.append(item)
    walk(bundle)
    return sorted(result)
selected=files()
checksums=''.join(hashlib.sha256(file.read_bytes()).hexdigest()+'  '+file.relative_to(bundle).as_posix()+'\n' for file in selected)
(bundle/'CHECKSUMS.sha256').write_text(checksums,encoding='utf-8')
destination=bundle.with_suffix('.zip')
with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for file in selected+[bundle/'CHECKSUMS.sha256']:archive.write(file,file.relative_to(bundle).as_posix())
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
    names=archive.namelist()
    assert 'workspace/source/.git/HEAD' in names
    assert not any('/node_modules/' in name or 'build-profile/' in name or 'headless-profile/' in name for name in names)
report={'status':'SUCCESS','zip':destination.name,'zipSha256':hashlib.sha256(destination.read_bytes()).hexdigest(),'bytes':destination.stat().st_size,'files':len(names),'sourceGitIncluded':True,'profilesAndCachesExcluded':True}
(bundle/'evidence/delivery-results.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
(destination.parent/(destination.name+'.sha256')).write_text(report['zipSha256']+'  '+destination.name+'\n',encoding='utf-8')
print(json.dumps(report))
