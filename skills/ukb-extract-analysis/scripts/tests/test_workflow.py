"""End-to-end checks use only fictional metadata and participant values."""
import csv
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

SKILL=Path(__file__).resolve().parents[2]
CLI=SKILL/'scripts/ukb.py'

class Workflow(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.db=self.root/'book.sqlite'
        source=sqlite3.connect((SKILL/'assets/codebook.sqlite').as_uri()+'?mode=ro',uri=True)
        target=sqlite3.connect(self.db)
        for (sql,) in source.execute("SELECT sql FROM sqlite_master WHERE type='table'"):
            target.execute(sql)
        source.close()
        target.executemany('INSERT INTO fields VALUES (?,?,?,?,?,?,?,?,?)', [('1','Fictional measurement','units','11','Test','9','2','Synthetic','2026'),('2','Fictional array','','21','Test','0','0','','2026')])
        for layout in ('web','easyukb'):
            for fid,instance,array in [('eid','',''),('1','0','0'),('1','1','0'),('2','0','0'),('2','0','1')]:
                col='eid' if fid=='eid' else f'{fid}-{instance}.{array}' if layout=='web' else f'p{fid}_i{instance}_a{array}'
                target.execute('INSERT INTO columns VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(layout,'participant','fixture',col,fid,'Fictional title',instance,array,'unit','Test','9' if fid=='1' else '0','Fake coding','fake.parquet','one_row_per_eid'))
        target.execute("INSERT INTO codings VALUES ('9','Synthetic coding','Test only')")
        target.execute("INSERT INTO coding_values VALUES ('9','-7','Fictional missing','','','','synthetic')")
        target.commit();target.close()

    def tearDown(self):self.tmp.cleanup()

    def call(self,*args,ok=True):
        proc=subprocess.run([sys.executable,str(CLI),'--codebook',str(self.db),*map(str,args)],capture_output=True,text=True)
        if ok:self.assertEqual(proc.returncode,0,proc.stderr)
        else:self.assertNotEqual(proc.returncode,0,proc.stdout)
        return json.loads(proc.stdout if proc.returncode==0 else proc.stderr)

    def plan(self,layout='web',name='plan',fields=('1','2')):
        p=self.root/name
        self.call('plan','--fields',*fields,'--layout',layout,'--instance','0','--out',p)
        return p

    def test_lookup_and_coding_are_offline(self):
        self.assertEqual(self.call('search','Fictional')['result']['total'],2)
        field=self.call('field','2','--layout','web')['result']
        self.assertEqual(field['columns'][1]['array_index'],'1')
        self.assertEqual(field['officialUrl'],'https://biobank.ndph.ox.ac.uk/showcase/field.cgi?id=2')
        coding=self.call('coding','9','--value','-7')['result']
        self.assertEqual(coding['rows'][0]['meaning'],'Fictional missing')
        self.assertEqual(coding['officialUrl'],'https://biobank.ndph.ox.ac.uk/showcase/coding.cgi?id=9')

    def test_type_metadata_is_separate_from_coding_title(self):
        p=self.plan();spec=json.loads((p/'spec.yaml').read_text())
        self.assertEqual(spec['variables'][1]['value_type'],'11')
        self.assertEqual(spec['variables'][1]['encoding_title'],'Fake coding')
        for filename in ('data_dictionary.csv','selected_variables.csv'):
            with (p/filename).open(encoding='utf-8-sig') as f:rows=list(csv.DictReader(f))
            self.assertEqual(rows[1]['type'],'11')
            self.assertEqual(rows[1]['coding_title'],'Fake coding')
            self.assertEqual(rows[1]['official_field_url'],'https://biobank.ndph.ox.ac.uk/showcase/field.cgi?id=1')
            self.assertEqual(rows[1]['official_coding_url'],'https://biobank.ndph.ox.ac.uk/showcase/coding.cgi?id=9')
            self.assertEqual(rows[0]['official_field_url'],'')
            self.assertEqual(rows[2]['official_coding_url'],'')

    def test_plan_keeps_arrays_zero_context_and_codings(self):
        p=self.plan();spec=json.loads((p/'spec.yaml').read_text())
        self.assertEqual([r['colname'] for r in spec['variables']],['eid','1-0.0','2-0.0','2-0.1'])
        self.assertEqual(spec['variables'][1]['instance'],['0'])
        with (p/'coding_values.csv').open(encoding='utf-8-sig') as f:rows=list(csv.DictReader(f))
        self.assertEqual(rows[0]['value'],'-7')
        self.assertFalse((p/'data.parquet').exists())
        self.assertFalse(json.loads((p/'manifest.json').read_text())['containsParticipantData'])

    def test_unknown_field_and_overlimit_fail_without_outputs(self):
        for fields,max_n in [(('1','999'),1000),(('1','2'),2)]:
            self.call('plan','--fields',*fields,'--layout','web','--all-instances','--max-selection',max_n,'--out',self.root/'bad',ok=False)
            self.assertFalse((self.root/'bad').exists())

    def test_no_overwrite_and_full_instances(self):
        p=self.root/'all'
        self.call('plan','--fields','1','--layout','web','--all-instances','--out',p)
        spec=json.loads((p/'spec.yaml').read_text())
        self.assertEqual(len(spec['variables']),3)
        self.call('plan','--fields','1','--layout','web','--instance','0','--out',p,ok=False)
        self.assertEqual(len(json.loads((p/'spec.yaml').read_text())['variables']),3)

    def test_packed_diagnosis_column_is_not_invented_into_arrays(self):
        db=sqlite3.connect(self.db)
        for col,fid,array in [('p41270','41270',''),('p41280_a0','41280','0'),('p41280_a1','41280','1')]:
            db.execute('INSERT INTO columns VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',('easyukb','participant','fixture',col,fid,'Fictional packed field','',array,'','Test','0','','fake.parquet','one_row_per_eid'))
        db.execute("INSERT INTO column_types VALUES ('easyukb','participant','p41270','string')")
        db.commit();db.close()
        out=self.root/'packed-plan'
        result=self.call('plan','--fields','41270','41280','--layout','easyukb','--all-instances','--out',out)['result']
        self.assertEqual(len(result['pairingWarnings']),1)
        spec=json.loads((out/'spec.yaml').read_text())
        self.assertEqual(spec['variables'][1]['colname'],'p41270')
        self.assertEqual(spec['variables'][1]['storage_type'],'string')

    def parquet(self,problem=None):
        import duckdb
        p=self.root/'fictional.parquet'
        con=duckdb.connect()
        eid='NULL' if problem=='null' else '1' if problem=='duplicate' else 'i'
        columns='' if problem=='missing' else ',i*2.5 AS "1-0.0",-7 AS "2-0.0",i+1 AS "2-0.1"'
        con.execute(f'COPY (SELECT {eid} AS eid {columns} FROM range(1,31) t(i)) TO ?',[str(p)]);con.close()
        return p

    def test_parquet_csv_values_and_limits(self):
        import duckdb
        p=self.plan();data=self.parquet()
        for fmt,limit,n in [('csv',2,2),('parquet',0,30)]:
            out=self.root/fmt
            response=self.call('extract-parquet','--plan',p,'--data-file',data,'--format',fmt,'--limit',limit,'--out',out)['result']
            self.assertEqual(response['rowCount'],n);self.assertNotIn('rows',response)
            con=duckdb.connect();relation=con.read_csv(str(out/'data.csv')) if fmt=='csv' else con.read_parquet(str(out/'data.parquet'))
            self.assertEqual(relation.columns,['eid','1-0.0','2-0.0','2-0.1']);rows=relation.fetchall()
            self.assertEqual(len(rows),n);self.assertEqual(rows[0],(1,2.5,-7,2));con.close()

    def test_parquet_invalid_eid_and_missing_fields_fail(self):
        p=self.plan()
        for problem in ('null','duplicate','missing'):
            data=self.parquet(problem)
            self.call('extract-parquet','--plan',p,'--data-file',data,'--out',self.root/problem,ok=False)
            self.assertFalse((self.root/problem).exists());data.unlink()

    def test_parquet_blank_eids_fail(self):
        import duckdb
        p=self.plan();data=self.root/'blank.parquet'
        for i,blank in enumerate(('', ' ', '\t\r\n')):
            with self.subTest(blank=repr(blank)):
                con=duckdb.connect()
                con.execute('CREATE TABLE source AS SELECT ? AS eid, 1 AS "1-0.0", 2 AS "2-0.0", 3 AS "2-0.1"',[blank])
                con.execute('COPY source TO ?',[str(data)]);con.close()
                self.call('extract-parquet','--plan',p,'--data-file',data,'--out',self.root/f'blank-{i}',ok=False)
                self.assertFalse((self.root/f'blank-{i}').exists());data.unlink()

    def test_old_plan_type_metadata_is_corrected_on_export(self):
        p=self.plan();data=self.parquet()
        spec=json.loads((p/'spec.yaml').read_text())
        for v in spec['variables']:
            v['value_type']=v.pop('encoding_title')
        (p/'spec.yaml').write_text(json.dumps(spec))
        out=self.root/'old-plan-export'
        self.call('extract-parquet','--plan',p,'--data-file',data,'--out',out)
        exported=json.loads((out/'spec.yaml').read_text())
        self.assertEqual(exported['variables'][1]['value_type'],'11')
        self.assertEqual(exported['variables'][1]['encoding_title'],'Fake coding')

    def create_rds(self,mismatch=False):
        import openpyxl
        raw=self.root/'raw';raw.mkdir()
        w=openpyxl.Workbook();ws=w.active;ws.append(['ID','name'])
        ws.append(['p1_i0_a0','one.rds']);ws.append(['p2_i0_a0','two.rds']);ws.append(['p2_i0_a1','two.rds'])
        w.save(raw/'ID.xlsx')
        script=self.root/'fixture.R'
        script.write_text('a<-commandArgs(TRUE)\nx<-data.frame(eid=c(3,1,2),p1_i0_a0=c(30,10,20))\nsaveRDS(x,file.path(a[1],"one.rds"))\ny<-data.frame(eid=c(2,3,'+('4' if mismatch else '1')+'),p2_i0_a0=c(200,300,100),p2_i0_a1=c(-7,-7,-7))\nsaveRDS(y,file.path(a[1],"two.rds"))\n')
        subprocess.run(['Rscript',str(script),str(raw)],check=True,capture_output=True)
        return raw

    def test_rds_slices_align_by_eid_and_preserve_values(self):
        p=self.plan('easyukb');raw=self.create_rds();out=self.root/'rds-out'
        self.assertEqual(self.call('extract-rds','--plan',p,'--raw-root',raw,'--limit','2','--out',out)['result']['rowCount'],2)
        check=self.root/'check.R'
        check.write_text('x<-readRDS(commandArgs(TRUE)[1]);stopifnot(identical(x$eid,c(1,2)),identical(x$p1_i0_a0,c(10,20)),identical(x$p2_i0_a0,c(100,200)),all(x$p2_i0_a1 == -7))')
        subprocess.run(['Rscript',str(check),str(out/'data.rds')],check=True,capture_output=True)

    def test_rds_different_participant_sets_fail(self):
        p=self.plan('easyukb');raw=self.create_rds(True)
        self.call('extract-rds','--plan',p,'--raw-root',raw,'--out',self.root/'bad-rds',ok=False)
        self.assertFalse((self.root/'bad-rds').exists())

    def test_rds_blank_eids_fail_even_for_one_slice(self):
        p=self.plan('easyukb',fields=('1',));raw=self.create_rds()
        for i,blank in enumerate(('', ' ', '\t\r\n')):
            with self.subTest(blank=repr(blank)):
                subprocess.run(['Rscript','-e','a<-commandArgs(TRUE);x<-readRDS(a[1]);x$eid<-as.character(x$eid);x$eid[1]<-a[2];saveRDS(x,a[1])',str(raw/'one.rds'),blank],check=True,capture_output=True)
                self.call('extract-rds','--plan',p,'--raw-root',raw,'--out',self.root/f'blank-rds-{i}',ok=False)
                self.assertFalse((self.root/f'blank-rds-{i}').exists())

    def test_rds_missing_index_field_fail(self):
        import openpyxl
        p=self.plan('easyukb');raw=self.create_rds()
        w=openpyxl.load_workbook(raw/'ID.xlsx');w.active.delete_rows(2);w.save(raw/'ID.xlsx')
        result=self.call('extract-rds','--plan',p,'--raw-root',raw,'--out',self.root/'bad-index',ok=False)
        self.assertIn('缺少请求字段',result['error'])

if __name__=='__main__':unittest.main(verbosity=2)
