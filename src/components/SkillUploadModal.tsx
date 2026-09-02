import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, X, FileArchive, Check, AlertCircle, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';
import {
  DEFAULT_SKILL_WORKFLOW_CATEGORY_KEY,
  SKILL_WORKFLOW_CATEGORY_DEFINITIONS,
  notifySkillWorkflowCategoriesUpdated,
  resolveSkillWorkflowCategoryKey,
  type SkillWorkflowCategoryDefinition,
  type SkillWorkflowCategoryKey,
} from './chat/constants/skillWorkflowCategories';

type ValidationResult = {
  valid: boolean;
  skillName?: string;
  frontmatter?: Record<string, unknown>;
  description?: string;
  fileCount?: number;
  hasPrompts?: boolean;
  hasReferences?: boolean;
  error?: string;
};

type SkillUploadModalProps = {
  projectName?: string | null;
  existingTags: { label: string; count: number }[];
  onClose: () => void;
  onUploadComplete: () => void;
};

function resolveLocaleKey(language: string): 'zh' | 'en' {
  return language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function workflowCategoryLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  category: SkillWorkflowCategoryDefinition,
): string {
  const key = `skillShortcuts.categories.${category.key}`;
  const label = t(key);
  return label === key ? category.key : label;
}

function categoryChipClass(selected: boolean): string {
  const color = selected
    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200'
    : 'border-border bg-background text-muted-foreground hover:bg-muted';
  return `rounded-full border px-2.5 py-1 text-xs transition cursor-pointer ${color}`;
}

export default function SkillUploadModal({ projectName, onClose, onUploadComplete }: SkillUploadModalProps) {
  const { t, i18n } = useTranslation('chat');
  const localeKey = resolveLocaleKey(i18n.language || 'en');
  const [file, setFile] = useState<File | null>(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [customName, setCustomName] = useState('');
  const [customDescription, setCustomDescription] = useState('');

  // Tag state
  const [selectedWorkflowCategory, setSelectedWorkflowCategory] = useState<SkillWorkflowCategoryKey>(
    DEFAULT_SKILL_WORKFLOW_CATEGORY_KEY,
  );
  const [origin, setOrigin] = useState<'downloaded' | 'human-written'>('downloaded');
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState('');

  const handleValidate = useCallback(async (zipFile: File) => {
    setValidating(true);
    setValidation(null);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', zipFile);
      const resp = await api.validateSkillZip(projectName, formData);
      const data = await resp.json();

      if (resp.ok && data.valid) {
        setValidation(data);
        setCustomName(data.skillName || '');
        setCustomDescription(data.description || '');
        setSelectedWorkflowCategory(resolveSkillWorkflowCategoryKey({
          name: data.skillName || zipFile.name,
          summary: [
            data.description,
            data.frontmatter ? JSON.stringify(data.frontmatter) : '',
          ].filter(Boolean).join(' '),
        }));
      } else {
        setValidation({ valid: false, error: data.error || 'Validation failed.' });
      }
    } catch (err) {
      setValidation({ valid: false, error: err instanceof Error ? err.message : 'Validation failed.' });
    } finally {
      setValidating(false);
    }
  }, [projectName]);

  const onDrop = useCallback((accepted: File[]) => {
    const zipFile = accepted[0];
    if (!zipFile) return;
    setFile(zipFile);
    setValidation(null);
    setUploadError(null);
    setSelectedWorkflowCategory(DEFAULT_SKILL_WORKFLOW_CATEGORY_KEY);
    setCustomName('');
    setCustomDescription('');
    setOrigin('downloaded');
    setCustomTags([]);
    handleValidate(zipFile);
  }, [handleValidate]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/zip': ['.zip'] },
    maxSize: 50 * 1024 * 1024,
    multiple: false,
  });

  const handleUpload = useCallback(async () => {
    if (!file || !validation?.valid) return;
    setUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const tags: Record<string, unknown> = { origin, workflowCategory: selectedWorkflowCategory };
      tags.skillName = customName.trim();
      tags.description = customDescription.trim();
      if (customTags.length > 0) {
        tags.customTags = customTags;
      }
      formData.append('tags', JSON.stringify(tags));

      const resp = await api.uploadSkill(projectName, formData);
      const data = await resp.json();

      if (resp.ok && data.success) {
        notifySkillWorkflowCategoriesUpdated();
        onUploadComplete();
        onClose();
      } else if (resp.status === 409) {
        setUploadError(data.error || 'A skill with that name already exists.');
      } else {
        setUploadError(data.error || 'Upload failed.');
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }, [file, validation, projectName, origin, selectedWorkflowCategory, customTags, customName, customDescription, onUploadComplete, onClose]);

  const addCustomTag = useCallback(() => {
    const tag = customTagInput.trim();
    if (tag && !customTags.includes(tag)) {
      setCustomTags((prev) => [...prev, tag]);
    }
    setCustomTagInput('');
  }, [customTagInput, customTags]);

  const removeCustomTag = useCallback((tag: string) => {
    setCustomTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-border bg-card p-5 shadow-2xl max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">Upload Skill</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Dropzone */}
        <div
          {...getRootProps()}
          className={`mb-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition cursor-pointer ${
            isDragActive
              ? 'border-sky-400 bg-sky-50/50 dark:bg-sky-950/30'
              : 'border-border bg-muted/30 hover:border-sky-300 hover:bg-sky-50/30 dark:hover:bg-sky-950/20'
          }`}
        >
          <input {...getInputProps()} />
          <UploadCloud className="h-8 w-8 text-muted-foreground mb-2" />
          {file ? (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <FileArchive className="h-4 w-4" />
              <span className="font-medium">{file.name}</span>
              <span className="text-muted-foreground">({(file.size / 1024).toFixed(0)} KB)</span>
            </div>
          ) : (
            <>
              <p className="text-sm text-foreground font-medium">
                Drag &amp; drop a .zip file here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground mt-1">Max 50MB. Must contain SKILL.md</p>
            </>
          )}
        </div>

        {/* Validating spinner */}
        {validating && (
          <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
            Validating...
          </div>
        )}

        {/* Validation error */}
        {validation && !validation.valid && (
          <div className="mb-4 rounded-md border border-red-300/60 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{validation.error}</span>
          </div>
        )}

        {/* Validation success - show skill info and tag selectors */}
        {validation?.valid && (
          <div className="space-y-4">
            {/* Skill info */}
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-2 mb-1">
                <Check className="h-4 w-4 text-green-500" />
                <span className="text-sm font-semibold text-foreground">{validation.skillName}</span>
              </div>
              {validation.description && (
                <p className="text-xs text-muted-foreground ml-6 mb-1">{validation.description}</p>
              )}
              <div className="flex flex-wrap gap-2 ml-6 text-xs text-muted-foreground">
                <span>{validation.fileCount} files</span>
                {validation.hasPrompts && <span>has prompts/</span>}
                {validation.hasReferences && <span>has references/</span>}
              </div>
            </div>

            {/* User-owned identity and description overrides */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  {localeKey === 'zh' ? '自定义技能 ID' : 'Custom Skill ID'}
                </label>
                <input
                  type="text"
                  value={customName}
                  onChange={(event) => setCustomName(event.target.value)}
                  placeholder="my-research-skill"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-sky-300/70 dark:focus:ring-sky-700/70"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {localeKey === 'zh' ? '将规范化为小写字母、数字和连字符。' : 'Normalized to lowercase letters, numbers, and dashes.'}
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  {localeKey === 'zh' ? '自定义简介' : 'Custom Description'}
                </label>
                <textarea
                  value={customDescription}
                  onChange={(event) => setCustomDescription(event.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-sky-300/70 dark:focus:ring-sky-700/70"
                />
              </div>
            </div>

            {/* Workflow category selector */}
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">
                {localeKey === 'zh' ? '工作流分类' : 'Workflow Category'}
              </label>
              <p className="mb-2 text-[11px] text-muted-foreground">
                {localeKey === 'zh'
                  ? '已根据技能名称和简介自动选择，你也可以手动修改。'
                  : 'Automatically selected from the skill name and description. You can change it manually.'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SKILL_WORKFLOW_CATEGORY_DEFINITIONS.map((category) => (
                  <button
                    key={category.key}
                    type="button"
                    onClick={() => setSelectedWorkflowCategory(category.key)}
                    className={categoryChipClass(selectedWorkflowCategory === category.key)}
                    title={workflowCategoryLabel(t, category)}
                  >
                    <span className="mr-1">{category.icon}</span>
                    {workflowCategoryLabel(t, category)}
                  </button>
                ))}
              </div>
            </div>

            {/* Origin selector */}
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">Origin</label>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="origin"
                    checked={origin === 'downloaded'}
                    onChange={() => setOrigin('downloaded')}
                    className="accent-sky-500"
                  />
                  <span className="text-foreground">Downloaded</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="origin"
                    checked={origin === 'human-written'}
                    onChange={() => setOrigin('human-written')}
                    className="accent-sky-500"
                  />
                  <span className="text-foreground">Human Written</span>
                </label>
              </div>
            </div>

            {/* Custom tags */}
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">Custom Tags</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {customTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs text-sky-700 dark:border-sky-600 dark:bg-sky-950/40 dark:text-sky-200"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeCustomTag(tag)}
                      className="hover:text-red-500"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customTagInput}
                  onChange={(e) => setCustomTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCustomTag();
                    }
                  }}
                  placeholder="Add a tag..."
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-sky-300/70 dark:focus:ring-sky-700/70"
                />
                <button
                  type="button"
                  onClick={addCustomTag}
                  disabled={!customTagInput.trim()}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background/80 px-2.5 py-1.5 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Upload error */}
        {uploadError && (
          <div className="mt-4 rounded-md border border-red-300/60 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}

        {/* Actions */}
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-background/80 text-sm text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!validation?.valid || !customName.trim() || uploading}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-md border border-sky-500 bg-sky-500 text-sm text-white hover:bg-sky-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Uploading...
              </>
            ) : (
              <>
                <UploadCloud className="h-3.5 w-3.5" />
                Upload Skill
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
