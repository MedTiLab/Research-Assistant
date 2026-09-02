import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database } from 'lucide-react';

const CATEGORIES = [
  { name: 'Relational DB', items: ['MySQL', 'PostgreSQL', 'SQL Server', 'Oracle', 'MariaDB', 'SQLite'] },
  { name: 'NoSQL', items: ['MongoDB', 'Redis', 'Cassandra', 'CouchDB', 'DynamoDB', 'Neo4j'] },
  { name: 'Clinical Data', items: ['REDCap', 'CDISC/SDTM', 'OMOP CDM', 'HL7 FHIR', 'i2b2', 'OHDSI'] },
  { name: 'Data Warehouse', items: ['Snowflake', 'BigQuery', 'Redshift', 'ClickHouse', 'Databricks', 'Hive'] },
  { name: 'File Formats', items: ['.csv', '.xlsx', '.parquet', '.json', '.arrow', '.feather', '.sas7bdat', '.sav'] },
  { name: 'Analytics Tools', items: ['Python', 'R', 'SQL', 'Pandas', 'Polars', 'DuckDB', 'Jupyter', 'dbt'] },
  { name: 'Cloud Services', items: ['AWS RDS', 'Azure SQL', 'GCP Cloud SQL', 'Supabase', 'PlanetScale', 'Neon'] },
  { name: 'Visualization', items: ['ECharts', 'Plotly', 'Matplotlib', 'ggplot2', 'D3.js', 'Tableau API'] },
];

export default function DataCompatibility({ dark }) {
  const { t } = useTranslation('landing');
  const [expanded, setExpanded] = useState(null);

  return (
    <section id="compatibility" className="relative py-24 px-6">
      <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-current to-transparent ${dark ? 'opacity-[0.06]' : 'opacity-[0.1]'}`} />
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 border border-emerald-500/20 bg-emerald-500/[0.06] rounded-full px-4 py-1.5 mb-6">
            <Database size={14} className="text-emerald-500" />
            <span className="text-xs text-emerald-600 font-medium tracking-wide uppercase">{t('compatibility.badge')}</span>
          </div>
          <h2 className={`text-3xl sm:text-4xl font-bold mb-4 ${dark ? 'text-white' : 'text-gray-900'}`}>
            {t('compatibility.title')} <span className="text-emerald-500">{t('compatibility.titleHighlight')}</span> {t('compatibility.titleEnd')}
          </h2>
          <p className={`text-lg max-w-2xl mx-auto ${dark ? 'text-white/40' : 'text-gray-500'}`}>{t('compatibility.subtitle')}</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {CATEGORIES.map((cat, i) => (
            <div key={i} onClick={() => setExpanded(expanded === i ? null : i)}
              className={`group cursor-pointer rounded-2xl p-5 transition-all duration-300 ${dark ? 'bg-white/[0.03] border border-white/[0.07] hover:border-emerald-500/20' : 'bg-white border border-gray-100 shadow-sm hover:border-emerald-200 hover:shadow-md hover:shadow-emerald-50'}`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className={`text-sm font-semibold ${dark ? 'text-white/80' : 'text-gray-800'}`}>{cat.name}</h3>
                <span className="text-xs text-emerald-500/70 font-mono">{cat.items.length}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(expanded === i ? cat.items : cat.items.slice(0, 4)).map((f, j) => (
                  <span key={j} className={`inline-block px-2.5 py-1 rounded-md text-xs border border-emerald-500/10 ${dark ? 'bg-emerald-500/[0.08] text-emerald-300/70' : 'bg-emerald-50 text-emerald-700'}`}>{f}</span>
                ))}
                {expanded !== i && cat.items.length > 4 && (
                  <span className={`inline-block px-2.5 py-1 rounded-md text-xs border ${dark ? 'bg-white/[0.04] text-white/30 border-white/[0.06]' : 'bg-gray-50 text-gray-400 border-gray-200'}`}>+{cat.items.length - 4}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
