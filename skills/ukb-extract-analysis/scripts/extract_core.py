"""Shared metadata artifact writer and single-matrix Parquet extraction.

Only extraction loads DuckDB; participant values are written to local files.
"""
import csv
import json
from pathlib import Path
from datetime import datetime, timezone
import re


META = ['dataset_id', 'colname', 'field_id', 'title', 'instance', 'array_index',
        'units', 'main_category_title', 'encoding_id', 'encoding_title',
        'mapping_status', 'data_path', 'grain']


def integer(value, name, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f'{name} 必须是 {minimum}–{maximum} 的整数')
    return value


def official_url(kind, identifier):
    value=str(identifier)
    if kind not in ('field','coding') or not re.fullmatch(r'[0-9]+',value) or value=='0':
        return ''
    return f'https://biobank.ndph.ox.ac.uk/showcase/{kind}.cgi?id={value}'


def write_metadata(folder, selected, args):
    project = str(args.get('project', 'UKB extraction'))[:200]
    spec = {'project': project, 'source': 'ukb',
            'created_at': datetime.now(timezone.utc).isoformat(), 'variables': []}
    for row in selected:
        spec['variables'].append({
            'name': row['colname'], 'field_id': row['field_id'], 'colname': row['colname'],
            'instance': [row['instance']] if row['instance'] != '' else [],
            'array': [row['array_index']] if row['array_index'] != '' else [],
            'title': row['title'], 'units': row['units'], 'value_type': row.get('value_type',''),
            'storage_type': row.get('storage_type',''), 'encoding_title': row['encoding_title'],
            'encoding_id': row['encoding_id'], 'category': row['main_category_title'],
            'official_field_url': official_url('field',row['field_id']),
            'official_coding_url': official_url('coding',row['encoding_id']),
            'dataset': row['dataset_id'], 'data_path': row['data_path'],
            'role': 'id' if row['colname'] == 'eid' else 'variable'})
    # JSON is a YAML 1.2 subset; no YAML dependency is needed to write spec.yaml.
    (folder / 'spec.yaml').write_text(json.dumps(spec, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    dictionaries = []
    for row in selected:
        dictionaries.append({'name': row['colname'], 'column': row['colname'], 'field_id': row['field_id'],
                             'label': row['title'], 'type': row.get('value_type',''), 'unit': row['units'],
                             'storage_type': row.get('storage_type',''), 'coding_title': row['encoding_title'],
                             'official_field_url': official_url('field',row['field_id']),
                             'official_coding_url': official_url('coding',row['encoding_id']),
                             'instance': row['instance'], 'array': row['array_index'],
                             'category': row['main_category_title'], 'source_table': row['dataset_id'],
                             'data_path': row['data_path'], 'role': 'id' if row['colname'] == 'eid' else 'variable'})
    with (folder / 'data_dictionary.csv').open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(dictionaries[0]))
        writer.writeheader()
        writer.writerows(dictionaries)
    fields = ['order', 'source', 'field', 'field_id', 'label', 'type', 'unit', 'instance', 'array', 'category', 'table', 'file', 'role', 'auto_added', 'storage_type', 'coding_title', 'official_field_url', 'official_coding_url']
    with (folder / 'selected_variables.csv').open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for i, row in enumerate(selected):
            writer.writerow(dict(zip(fields, [i+1, 'ukb', row['colname'], row['field_id'], row['title'], row.get('value_type',''), row['units'], row['instance'], row['array_index'], row['main_category_title'], row['dataset_id'], row['data_path'], 'id' if i == 0 else 'variable', 'yes' if i == 0 else 'no', row.get('storage_type',''), row['encoding_title'], official_url('field',row['field_id']), official_url('coding',row['encoding_id'])])))


def extract(folder, selected, args):
    import duckdb
    raw = args.get('dataFile')
    if not isinstance(raw, str) or not raw or not Path(raw).expanduser().is_absolute():
        raise ValueError('请明确提供本地 Parquet 的绝对路径 dataFile')
    source = Path(raw).expanduser().resolve(strict=True)
    if not source.is_file() or source.suffix.lower() != '.parquet':
        raise ValueError('dataFile 必须是单个本地 .parquet 文件')
    fmt = args.get('format', 'parquet')
    if fmt not in ('csv', 'parquet'):
        raise ValueError('format 必须是 csv 或 parquet')
    limit = integer(args.get('limit', 20), 'limit', 0, 1000000000)
    con = duckdb.connect(':memory:')
    try:
        con.execute('SET threads=2')
        con.read_parquet(str(source)).create_view('ukb_source')
        columns = [row[0] for row in con.execute('DESCRIBE ukb_source').fetchall()]
        selected_names = [row['colname'] for row in selected]
        missing = [name for name in selected_names if name not in columns]
        if missing:
            raise ValueError('Parquet 缺少请求列: ' + ', '.join(missing))
        n, count, unique, blank = con.execute("SELECT count(*), count(eid), count(DISTINCT eid), count(*) FILTER (WHERE regexp_full_match(CAST(eid AS VARCHAR), '[[:space:]]*')) FROM ukb_source").fetchone()
        if n != count or n != unique or blank:
            raise ValueError('eid 存在空值或重复值，不是安全的 participant-level 矩阵')
        quoted = ', '.join('"' + name.replace('"', '""') + '"' for name in selected_names)
        query = f'SELECT {quoted} FROM ukb_source ORDER BY eid' + (f' LIMIT {limit}' if limit else '')
        destination = folder / ('data.' + fmt)
        # File path is bound; names are individually quoted; no model SQL is accepted.
        options = "FORMAT PARQUET, COMPRESSION ZSTD" if fmt == 'parquet' else 'FORMAT CSV, HEADER true'
        con.execute(f'COPY ({query}) TO ? ({options})', [str(destination)])
        return {'rowCount': min(n, limit) if limit else n, 'sourceRowCount': n,
                'format': fmt, 'dataFile': str(source), 'limit': limit}
    finally:
        con.close()
