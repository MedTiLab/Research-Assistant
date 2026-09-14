"""Build an allowlisted, participant-free UKB codebook from metadata only."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import re
import sqlite3


def text(value):
    return '' if value is None else str(value)


def build(reference_dir, web_index, easy_dictionary, destination):
    import openpyxl
    ref, out = Path(reference_dir), Path(destination)
    if out.exists():
        raise ValueError('拒绝覆盖已有 codebook；请使用新输出路径')
    out.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(out)
    db.executescript('''
    CREATE TABLE fields(field_id TEXT PRIMARY KEY,title TEXT,units TEXT,value_type TEXT,category TEXT,encoding_id TEXT,instance_id TEXT,notes TEXT,version TEXT);
    CREATE TABLE columns(layout TEXT,entity TEXT,dataset_id TEXT,colname TEXT,field_id TEXT,title TEXT,instance TEXT,array_index TEXT,units TEXT,main_category_title TEXT,encoding_id TEXT,encoding_title TEXT,data_path TEXT,grain TEXT);
    CREATE TABLE codings(encoding_id TEXT PRIMARY KEY,title TEXT,description TEXT);
    CREATE TABLE coding_values(encoding_id TEXT,value TEXT,meaning TEXT,code_id TEXT,parent_id TEXT,selectable TEXT,source_table TEXT);
    CREATE TABLE instance_values(instance_id TEXT,instance_index TEXT,title TEXT,description TEXT);
    CREATE TABLE column_types(layout TEXT,entity TEXT,colname TEXT,storage_type TEXT);
    CREATE TABLE provenance(source TEXT PRIMARY KEY,sha256 TEXT,records INTEGER);
    ''')
    def rows(filename):
        path = ref / filename
        db.execute('INSERT INTO provenance VALUES (?,?,?)', (filename, hashlib.sha256(path.read_bytes()).hexdigest(), None))
        return list(csv.DictReader(path.open(encoding='utf-8-sig', newline=''), delimiter='\t', quoting=csv.QUOTE_NONE))
    try:
        categories = {r['category_id']: r['title'] for r in rows('category.txt')}
        encodings = rows('encoding.txt')
        coding_names = {r['encoding_id']: r['title'] for r in encodings}
        db.executemany('INSERT INTO codings VALUES (?,?,?)', [(r['encoding_id'],r['title'],r['descript']) for r in encodings])
        fields = rows('field.txt')
        db.executemany('INSERT INTO fields VALUES (?,?,?,?,?,?,?,?,?)', [(r['field_id'],r['title'],r['units'],r['value_type'],categories.get(r['main_category'],''),r['encoding_id'],r['instance_id'],r['notes'],r['version']) for r in fields])
        for filename in ['esimpint.txt','esimpstring.txt','esimpreal.txt','esimpdate.txt','esimptime.txt','ehierint.txt','ehierstring.txt']:
            entries = rows(filename)
            db.executemany('INSERT INTO coding_values VALUES (?,?,?,?,?,?,?)', [(r['encoding_id'],r['value'],r['meaning'],r.get('code_id',''),r.get('parent_id',''),r.get('selectable',''),filename) for r in entries])
            db.execute('UPDATE provenance SET records=? WHERE source=?',(len(entries),filename))
        # Supplement the locally supplied protein coding only when absent from the general tables.
        if (ref/'coding143.tsv').exists() and not db.execute("SELECT 1 FROM coding_values WHERE encoding_id='143' LIMIT 1").fetchone():
            entries = rows('coding143.tsv')
            db.executemany('INSERT INTO coding_values VALUES (?,?,?,?,?,?,?)',[('143',r['coding'],r['meaning'],'','','','coding143.tsv') for r in entries])
        db.executemany('INSERT INTO instance_values VALUES (?,?,?,?)', [(r['instance_id'],r['index'],r['title'],r['descript']) for r in rows('insvalue.txt')])
        with Path(web_index).open(encoding='utf-8-sig', newline='') as f:
            web = list(csv.DictReader(f))
        db.executemany('INSERT INTO columns VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [('web','participant',r['dataset_id'],r['colname'],r['field_id'],r['title'],r['instance'],r['array_index'],r['units'],r['main_category_title'],r['encoding_id'],r['encoding_title'],r['data_path'],r['grain']) for r in web])
        workbook = openpyxl.load_workbook(easy_dictionary,read_only=True,data_only=True)
        iterator = workbook.worksheets[0].iter_rows(values_only=True)
        header = next(iterator)
        easy = []
        for row in iterator:
            r = dict(zip(header,row)); col = text(r['ID'])
            if not col:
                continue
            match = re.fullmatch(r'p(\d+)(?:_i(\d+))?(?:_a(\d+))?',col)
            fid, instance, array = (match.group(1),match.group(2) or '',match.group(3) or '') if match else ('eid' if col=='eid' else '', '', '')
            coding = re.fullmatch(r'data_coding_(\d+)',text(r.get('coding_name')))
            encoding = coding.group(1) if coding else ''
            entity = text(r.get('entity'))
            db.execute('INSERT INTO column_types VALUES (?,?,?,?)',('easyukb',entity,col,text(r.get('type'))))
            easy.append(('easyukb',entity,entity,col,fid,text(r.get('title')),instance,array,text(r.get('units')),text(r.get('folder_path')),encoding,coding_names.get(encoding,''),'','one_row_per_eid' if entity=='participant' else 'event_or_omics'))
        workbook.close()
        db.executemany('INSERT INTO columns VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',easy)
        for label,path,count in [('ukb_variable_index.csv',web_index,len(web)),('dataset.data_dictionary.xlsx',easy_dictionary,len(easy))]:
            db.execute('INSERT INTO provenance VALUES (?,?,?)',(label,hashlib.sha256(Path(path).read_bytes()).hexdigest(),count))
        db.executescript('''CREATE INDEX columns_field ON columns(layout,entity,field_id); CREATE INDEX columns_name ON columns(layout,colname); CREATE INDEX coding_lookup ON coding_values(encoding_id,value);''')
        db.commit()
        summary = {t: db.execute(f'SELECT count(*) FROM {t}').fetchone()[0] for t in ['fields','columns','codings','coding_values','instance_values']}
        summary['columns_by_layout'] = dict(db.execute('SELECT layout,count(*) FROM columns GROUP BY layout'))
        summary['participant_columns_by_layout'] = dict(db.execute("SELECT layout,count(*) FROM columns WHERE entity='participant' GROUP BY layout"))
        summary['coded_field_definitions_without_local_values'] = db.execute("SELECT count(*) FROM fields WHERE encoding_id NOT IN ('','0') AND encoding_id NOT IN (SELECT encoding_id FROM coding_values)").fetchone()[0]
        summary['source_field_versions'] = db.execute('SELECT min(version),max(version) FROM fields').fetchone()
        summary['contains_participant_records'] = False
        summary['build_date'] = '2026-09-06'
        out.with_suffix('.summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        return summary
    except BaseException:
        db.close()
        out.unlink(missing_ok=True)
        raise
    finally:
        db.close()


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--reference-dir',required=True)
    p.add_argument('--web-index',required=True)
    p.add_argument('--easy-dictionary',required=True)
    p.add_argument('--out',required=True)
    a=p.parse_args()
    print(json.dumps(build(a.reference_dir,a.web_index,a.easy_dictionary,a.out),ensure_ascii=False,indent=2))
