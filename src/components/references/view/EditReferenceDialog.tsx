import { Loader2, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../../utils/api';
import { Button } from '../../ui/button';
import type { Reference, ReferenceAuthor } from '../types';

type EditReferenceDialogProps = {
  reference: Reference;
  onClose: () => void;
  onSaved: (reference: Reference) => void;
};

type ReferenceDraft = {
  title: string;
  authorsText: string;
  year: string;
  doi: string;
  journal: string;
  url: string;
  itemType: string;
  citationKey: string;
  keywordsText: string;
  abstract: string;
};

function authorsToText(authors: ReferenceAuthor[]): string {
  return authors.map((author) => [author.family, author.given].filter(Boolean).join(', ')).join('\n');
}

function parseAuthors(value: string): ReferenceAuthor[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const comma = line.indexOf(',');
    if (comma >= 0) {
      return { family: line.slice(0, comma).trim(), given: line.slice(comma + 1).trim() };
    }
    const words = line.split(/\s+/);
    return words.length === 1
      ? { family: words[0], given: '' }
      : { family: words.at(-1) || '', given: words.slice(0, -1).join(' ') };
  }).filter((author) => author.family || author.given);
}

function makeDraft(reference: Reference): ReferenceDraft {
  return {
    title: reference.title || '',
    authorsText: authorsToText(reference.authors || []),
    year: reference.year ? String(reference.year) : '',
    doi: reference.doi || '',
    journal: reference.journal || '',
    url: reference.url || '',
    itemType: reference.item_type || 'article',
    citationKey: reference.citation_key || '',
    keywordsText: (reference.keywords || []).join(', '),
    abstract: reference.abstract || '',
  };
}

export default function EditReferenceDialog({ reference, onClose, onSaved }: EditReferenceDialogProps) {
  const [draft, setDraft] = useState(() => makeDraft(reference));
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const update = (field: keyof ReferenceDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(null);
    setNotice(null);
  };

  const resolveDoi = async () => {
    if (!draft.doi.trim() || resolving) return;
    setResolving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api.references.resolveDoi(draft.doi.trim());
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'DOI 元数据获取失败');
      const metadata = payload.metadata || {};
      setDraft((current) => ({
        ...current,
        title: metadata.title || current.title,
        authorsText: Array.isArray(metadata.authors) && metadata.authors.length > 0
          ? authorsToText(metadata.authors)
          : current.authorsText,
        year: metadata.year ? String(metadata.year) : current.year,
        doi: metadata.doi || current.doi,
        journal: metadata.journal || current.journal,
        url: metadata.url || current.url,
        itemType: metadata.item_type || current.itemType,
        abstract: metadata.abstract || current.abstract,
      }));
      setNotice('已从 Crossref 预填，请检查后保存。');
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : 'DOI 元数据获取失败');
    } finally {
      setResolving(false);
    }
  };

  const save = async () => {
    if (!draft.title.trim() || saving) {
      if (!draft.title.trim()) setError('标题不能为空');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await api.references.update(reference.id, {
        title: draft.title.trim(),
        authors: parseAuthors(draft.authorsText),
        year: draft.year.trim() || null,
        doi: draft.doi.trim() || null,
        journal: draft.journal.trim() || null,
        url: draft.url.trim() || null,
        item_type: draft.itemType.trim() || 'article',
        citation_key: draft.citationKey.trim() || null,
        keywords: draft.keywordsText.split(/[,;\n]/).map((keyword) => keyword.trim()).filter(Boolean),
        abstract: draft.abstract.trim() || null,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '保存失败');
      onSaved(payload.reference as Reference);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10';
  const textareaClass = 'mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10';

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={() => { if (!saving) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="edit-reference-title" className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-6 py-4 backdrop-blur">
          <div>
            <h2 id="edit-reference-title" className="text-lg font-semibold text-foreground">编辑文献元数据</h2>
            <p className="mt-1 text-xs text-muted-foreground">修改会同步到已关联项目的知识库文献条目。</p>
          </div>
          <button type="button" disabled={saving} onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
          <label className="sm:col-span-2 text-xs font-medium text-foreground">标题
            <input value={draft.title} onChange={(event) => update('title', event.target.value)} className={inputClass} />
          </label>
          <label className="sm:col-span-2 text-xs font-medium text-foreground">作者（每行一位，建议“姓, 名”）
            <textarea rows={4} value={draft.authorsText} onChange={(event) => update('authorsText', event.target.value)} className={textareaClass} />
          </label>
          <label className="text-xs font-medium text-foreground">年份
            <input inputMode="numeric" value={draft.year} onChange={(event) => update('year', event.target.value)} className={inputClass} />
          </label>
          <label className="text-xs font-medium text-foreground">文献类型
            <input value={draft.itemType} onChange={(event) => update('itemType', event.target.value)} className={inputClass} />
          </label>
          <label className="sm:col-span-2 text-xs font-medium text-foreground">DOI
            <div className="flex gap-2">
              <input value={draft.doi} onChange={(event) => update('doi', event.target.value)} placeholder="10.xxxx/…" className={inputClass} />
              <Button type="button" size="sm" variant="outline" className="mt-1 h-9 shrink-0" disabled={!draft.doi.trim() || resolving} onClick={() => void resolveDoi()}>
                {resolving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} 权威预填
              </Button>
            </div>
          </label>
          <label className="text-xs font-medium text-foreground">期刊 / 会议
            <input value={draft.journal} onChange={(event) => update('journal', event.target.value)} className={inputClass} />
          </label>
          <label className="text-xs font-medium text-foreground">引用键
            <input value={draft.citationKey} onChange={(event) => update('citationKey', event.target.value)} className={inputClass} />
          </label>
          <label className="sm:col-span-2 text-xs font-medium text-foreground">来源 URL
            <input value={draft.url} onChange={(event) => update('url', event.target.value)} className={inputClass} />
          </label>
          <label className="sm:col-span-2 text-xs font-medium text-foreground">关键词（逗号分隔）
            <input value={draft.keywordsText} onChange={(event) => update('keywordsText', event.target.value)} className={inputClass} />
          </label>
          <label className="sm:col-span-2 text-xs font-medium text-foreground">摘要
            <textarea rows={7} value={draft.abstract} onChange={(event) => update('abstract', event.target.value)} className={textareaClass} />
          </label>
          {notice && <p className="sm:col-span-2 rounded-md bg-primary/10 px-3 py-2 text-xs text-primary">{notice}</p>}
          {error && <p className="sm:col-span-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-card/95 px-6 py-4 backdrop-blur">
          <Button variant="ghost" disabled={saving} onClick={onClose}>取消</Button>
          <Button disabled={saving || !draft.title.trim()} onClick={() => void save()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} 保存并同步
          </Button>
        </div>
      </div>
    </div>
  );
}
