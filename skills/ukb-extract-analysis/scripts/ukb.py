"""AI-facing offline UKB codebook, extraction plans, and local extraction CLI."""
import argparse
import csv
import json
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import extract_core


DEFAULT_DB = Path(__file__).resolve().parents[1] / 'assets/codebook.sqlite'


def dictionaries(cursor):
    return [dict(row) for row in cursor]


def enrich_metadata(db, selected, layout):
    for row in selected:
        definition=db.execute('SELECT value_type FROM fields WHERE field_id=?',(row['field_id'],)).fetchone()
        row['value_type']=definition[0] if definition else ''
        types=db.execute("SELECT storage_type FROM column_types WHERE layout=? AND entity='participant' AND colname=?",(layout,row['colname'])).fetchall()
        row['storage_type']=types[0][0] if len(types)==1 else ''


def field_ids(values):
    result=[]
    for value in values:
        fid=value.removeprefix('p')
        if not re.fullmatch(r'\d+',fid):
            raise ValueError('Field ID 应为数字，例如 21001；具体物理列由 codebook 展开')
        if fid in result:
            raise ValueError('重复 Field ID: '+fid)
        result.append(fid)
    return result


def chosen_rows(db, args):
    chosen=[]
    for fid in field_ids(args.fields):
        rows=dictionaries(db.execute("SELECT * FROM columns WHERE layout=? AND entity='participant' AND field_id=? ORDER BY CAST(instance AS INTEGER),CAST(array_index AS INTEGER),colname",(args.layout,fid)))
        if args.instance is not None:
            rows=[r for r in rows if r['instance'] in ('',str(args.instance))]
        if not rows:
            raise ValueError(f'{args.layout} 字典未收录 Field {fid} 的请求实例；不可用其他字段代替')
        chosen.extend(rows)
    if len(chosen)>args.max_selection:
        raise ValueError(f'展开后 {len(chosen)} 列超过 max-selection={args.max_selection}；需显式调整上限')
    contexts={(r['dataset_id'],r['data_path']) for r in chosen}
    if len(contexts)!=1:
        raise ValueError('跨文件选择需要显式设计 join；本命令只处理单个 participant-level 矩阵')
    if len({r['colname'] for r in chosen})!=len(chosen):
        raise ValueError('字典包含重复或歧义列名')
    identifier=dictionaries(db.execute("SELECT * FROM columns WHERE layout=? AND entity='participant' AND colname='eid'",(args.layout,)))
    identifier=[r for r in identifier if (r['dataset_id'],r['data_path']) in contexts]
    if len(identifier)!=1:
        raise ValueError('缺少唯一 eid 元数据定义')
    return identifier+chosen


def add_codebook(db, folder, selected, layout):
    spec_path=folder/'spec.yaml'
    spec=json.loads(spec_path.read_text(encoding='utf-8'))
    spec['layout']=layout
    spec['codebook_version']='local-snapshot-2026-09-06'
    warnings=[]
    for code_field,date_field in [('41270','41280')]:
        codes={(r['instance'],r['array_index']) for r in selected if r['field_id']==code_field}
        dates={(r['instance'],r['array_index']) for r in selected if r['field_id']==date_field}
        if codes and dates and codes!=dates:
            warnings.append(f'Field {code_field}/{date_field} 的列展开不同；可能存在打包字符串/列表，未经实际存储布局核验不能按 array 关联诊断与日期')
    spec['pairing_warnings']=warnings
    spec_path.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    codes=sorted({r['encoding_id'] for r in selected if r['encoding_id'] not in ('','0')})
    coding_rows=[];missing=[]
    for code in codes:
        values=dictionaries(db.execute('SELECT * FROM coding_values WHERE encoding_id=? ORDER BY source_table,value',(code,)))
        if not values:missing.append(code)
        coding_rows.extend(values)
    with (folder/'coding_values.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=['encoding_id','value','meaning','code_id','parent_id','selectable','source_table'])
        writer.writeheader();writer.writerows(coding_rows)
    ids=[r['colname'] for r in selected if r['colname']!='eid']
    (folder/'field_ids.txt').write_text('\n'.join(ids)+'\n',encoding='utf-8')
    # These column names came from the validated metadata, and JSON escaping is R-compatible here.
    (folder/'field_ids.R').write_text('field_ids <- c('+', '.join(json.dumps(s) for s in ids)+')\n',encoding='utf-8')
    return {'codingValueRows':len(coding_rows),'missingCodingIds':missing,'pairingWarnings':warnings}


def load_plan(path):
    path=Path(path)
    if path.is_dir():path=path/'spec.yaml'
    spec=json.loads(path.read_text(encoding='utf-8'))
    if spec.get('source')!='ukb' or spec.get('layout') not in ('web','easyukb'):
        raise ValueError('需要本 skill 生成的 UKB spec.yaml')
    rows=[]
    for v in spec['variables']:
        rows.append({'dataset_id':v['dataset'],'data_path':v['data_path'],'colname':v['colname'],
                     'field_id':v['field_id'],'title':v['title'],'instance':(v['instance'] or [''])[0],
                     'array_index':(v['array'] or [''])[0],'units':v['units'],'encoding_id':v['encoding_id'],
                     'encoding_title':v.get('encoding_title',v['value_type']),'main_category_title':v['category'],'grain':'one_row_per_eid'})
    if len(rows)<2 or rows[0]['colname']!='eid' or len({r['colname'] for r in rows})!=len(rows):
        raise ValueError('方案必须包含 eid 和至少一个研究变量，且列名不能重复')
    if len({(r['dataset_id'],r['data_path']) for r in rows})!=1:
        raise ValueError('方案包含多个文件来源')
    return spec,rows


def rds_extract(folder, selected, args):
    import openpyxl
    root=Path(args.raw_root).expanduser().resolve(strict=True)
    workbook=openpyxl.load_workbook(root/'ID.xlsx',read_only=True,data_only=True)
    it=workbook.worksheets[0].iter_rows(values_only=True)
    headers=list(next(it))
    if not {'ID','name'}.issubset(headers):
        workbook.close();raise ValueError('ID.xlsx 必须包含大写 ID 和 name 列')
    wanted={r['colname'] for r in selected if r['colname']!='eid'}
    mapping={}
    for row in it:
        item=dict(zip(headers,row))
        if item['ID'] in wanted:
            if item['ID'] in mapping:raise ValueError('ID.xlsx 中请求字段重复: '+item['ID'])
            mapping[item['ID']]=str(item['name'] or '')
    workbook.close()
    missing=wanted-mapping.keys()
    if missing:raise ValueError('ID.xlsx 缺少请求字段: '+', '.join(sorted(missing)))
    groups={}
    for col,name in mapping.items():
        if not name:raise ValueError('空切片文件名: '+col)
        raw=Path(name)
        candidates=[]
        if raw.is_absolute():candidates=[raw]
        elif raw.parent!=Path('.'):
            candidates=[root/raw]
        else:
            candidates=[p for p in root.rglob('*.rds') if p.name in (name,name+'.rds')]
        files=sorted({p.resolve() for p in candidates if p.is_file() and p.suffix.lower()=='.rds'})
        if len(files)!=1 or not files[0].is_relative_to(root):
            raise ValueError('切片路径缺失、存在歧义或超出原始数据目录: '+name)
        groups.setdefault(str(files[0]),[]).append(col)
    request={'groups':[{'path':path,'columns':cols} for path,cols in groups.items()],
             'columns':[r['colname'] for r in selected], 'out':str(folder/'data.rds'),'limit':args.limit}
    request_path=folder/'.rds-request.json'
    request_path.write_text(json.dumps(request),encoding='utf-8')
    result=subprocess.run([args.rscript,str(Path(__file__).with_name('extract_rds.R')),str(request_path)],capture_output=True,text=True)
    request_path.unlink()
    if result.returncode:
        # R error details can contain cell values; keep model-facing errors independent of data.
        raise ValueError('RDS 提取失败：检查 R/jsonlite、切片列、eid 唯一性与各切片参与者集合；未生成成功导出')
    summary=json.loads(result.stdout)
    return {**summary,'format':'rds','limit':args.limit,'rawRoot':str(root)}


def run(args):
    with sqlite3.connect(Path(args.codebook).resolve().as_uri()+'?mode=ro',uri=True) as db:
        db.row_factory=sqlite3.Row
        if args.command=='status':
            return {'codebook':str(Path(args.codebook).resolve()),'tables':{t:db.execute(f'SELECT count(*) FROM {t}').fetchone()[0] for t in ['fields','columns','codings','coding_values']},'rawDataIncluded':False}
        if args.command=='search':
            terms=args.query.split()
            sql='SELECT field_id,title,units,category,encoding_id,version FROM fields WHERE '+(' AND '.join('(title || \' \' || notes || \' \' || category) LIKE ?' for _ in terms) or '1')
            values=['%'+term+'%' for term in terms]
            total=db.execute('SELECT count(*) FROM ('+sql+')',values).fetchone()[0]
            return {'total':total,'offset':args.offset,'rows':dictionaries(db.execute(sql+' ORDER BY field_id LIMIT ? OFFSET ?',values+[args.limit,args.offset]))}
        if args.command=='field':
            fid=field_ids([args.field])[0]
            definition=dictionaries(db.execute('SELECT * FROM fields WHERE field_id=?',(fid,)))
            coverage=dictionaries(db.execute('SELECT layout,entity,count(*) AS columns FROM columns WHERE field_id=? GROUP BY layout,entity',(fid,)))
            if not definition and not coverage:raise ValueError('Codebook 未收录此 Field ID')
            return {'definition':definition,'officialUrl':extract_core.official_url('field',fid),'coverage':coverage,'columns':dictionaries(db.execute('SELECT layout,colname,instance,array_index,encoding_id FROM columns WHERE field_id=? AND layout=? ORDER BY CAST(instance AS INTEGER),CAST(array_index AS INTEGER)',(fid,args.layout)))}
        if args.command=='coding':
            where='encoding_id=?';values=[args.coding_id]
            if args.value is not None:where+=' AND value=?';values.append(args.value)
            if args.query:where+=' AND meaning LIKE ?';values.append('%'+args.query+'%')
            count=db.execute('SELECT count(*) FROM coding_values WHERE '+where,values).fetchone()[0]
            return {'definition':dictionaries(db.execute('SELECT * FROM codings WHERE encoding_id=?',(args.coding_id,))),'officialUrl':extract_core.official_url('coding',args.coding_id),'total':count,'offset':args.offset,'rows':dictionaries(db.execute('SELECT * FROM coding_values WHERE '+where+' ORDER BY source_table,value LIMIT ? OFFSET ?',values+[args.limit,args.offset]))}
        if args.command=='plan':
            selected=chosen_rows(db,args);layout=args.layout;project=args.project
        else:
            spec,selected=load_plan(args.plan);layout=spec['layout'];project=spec['project']
            if args.command=='extract-rds' and layout!='easyukb':raise ValueError('RDS 提取需要 --layout easyukb 方案')
        enrich_metadata(db,selected,layout)
        final=Path(args.out).expanduser().resolve()
        if final.exists():raise ValueError('输出目录已存在；请提供新目录以保留已有结果')
        final.parent.mkdir(parents=True,exist_ok=True)
        folder=Path(tempfile.mkdtemp(prefix='.ukb-pending-',dir=final.parent))
        try:
            summary={}
            if args.command=='extract-parquet':
                summary=extract_core.extract(folder,selected,{'dataFile':args.data_file,'format':args.format,'limit':args.limit})
            elif args.command=='extract-rds':summary=rds_extract(folder,selected,args)
            extract_core.write_metadata(folder,selected,{'project':project})
            summary.update(add_codebook(db,folder,selected,layout))
            summary.update({'action':args.command,'layout':layout,'columns':[r['colname'] for r in selected],
                            'containsParticipantData':args.command!='plan'})
            (folder/'manifest.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
            if final.exists():raise ValueError('输出目录被其他任务占用')
            folder.rename(final)
            return {**summary,'outputDir':str(final)}
        except BaseException:
            shutil.rmtree(folder);raise


def nonnegative(s):
    v=int(s)
    if v<0:raise argparse.ArgumentTypeError('须为非负整数')
    return v


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--codebook',default=str(DEFAULT_DB))
    sub=p.add_subparsers(dest='command',required=True)
    sub.add_parser('status')
    s=sub.add_parser('search');s.add_argument('query');s.add_argument('--limit',type=nonnegative,default=30);s.add_argument('--offset',type=nonnegative,default=0)
    f=sub.add_parser('field');f.add_argument('field');f.add_argument('--layout',choices=['web','easyukb'],default='easyukb')
    c=sub.add_parser('coding');c.add_argument('coding_id');c.add_argument('--value');c.add_argument('--query');c.add_argument('--limit',type=nonnegative,default=30);c.add_argument('--offset',type=nonnegative,default=0)
    plan=sub.add_parser('plan');plan.add_argument('--fields',nargs='+',required=True);plan.add_argument('--layout',choices=['web','easyukb'],required=True)
    instances=plan.add_mutually_exclusive_group(required=True);instances.add_argument('--instance',type=nonnegative);instances.add_argument('--all-instances',action='store_true')
    plan.add_argument('--project',default='UKB extraction');plan.add_argument('--max-selection',type=nonnegative,default=1000);plan.add_argument('--out',required=True)
    for action in ['extract-parquet','extract-rds']:
        e=sub.add_parser(action);e.add_argument('--plan',required=True);e.add_argument('--out',required=True);e.add_argument('--limit',type=nonnegative,default=20)
        if action=='extract-parquet':e.add_argument('--data-file',required=True);e.add_argument('--format',choices=['csv','parquet'],default='parquet')
        else:e.add_argument('--raw-root',required=True);e.add_argument('--rscript',default='Rscript')
    args=p.parse_args()
    try:print(json.dumps({'ok':True,'result':run(args)},ensure_ascii=False,indent=2))
    except Exception as error:
        message=str(error) if isinstance(error,(ValueError,FileNotFoundError,ModuleNotFoundError)) else '操作失败，请检查依赖、输入格式、权限与磁盘空间；未返回参与者数据'
        print(json.dumps({'ok':False,'error':message},ensure_ascii=False),file=sys.stderr);return 1
    return 0


if __name__=='__main__':sys.exit(main())
