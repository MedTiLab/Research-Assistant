import { describe, expect, it, vi } from 'vitest';

import {
  getTranscriptPageStart,
  loadTranscriptWindow,
  reconcilePersistedSessionMessages,
  shouldHoldLiveTranscript,
} from './sessionTranscriptReconciliation';

describe('reconcilePersistedSessionMessages', () => {
  it('retains the existing empty reference while persistence is still empty', () => {
    const current: unknown[] = [];
    expect(reconcilePersistedSessionMessages(current, [])).toBe(current);
  });

  it('retains the existing reference for an unchanged completion snapshot', () => {
    const current = [{ type: 'user', content: 'hello' }];
    const incoming = [{ type: 'user', content: 'hello' }];

    expect(reconcilePersistedSessionMessages(current, incoming)).toBe(current);
  });

  it('does not regress when an older persisted page arrives late', () => {
    const current = [
      { type: 'user', content: 'hello' },
      { type: 'assistant', content: 'answer' },
    ];
    const incoming = [{ type: 'user', content: 'hello' }];

    expect(reconcilePersistedSessionMessages(current, incoming)).toBe(current);
  });

  it('accepts a newly persisted final message', () => {
    const current = [{ type: 'user', content: 'hello' }];
    const incoming = [
      { type: 'user', content: 'hello' },
      { type: 'assistant', content: 'answer' },
    ];

    expect(reconcilePersistedSessionMessages(current, incoming)).toBe(incoming);
  });

  it('accepts updated content when the item count is unchanged', () => {
    const current = [{ type: 'assistant', content: 'partial' }];
    const incoming = [{ type: 'assistant', content: 'complete' }];

    expect(reconcilePersistedSessionMessages(current, incoming)).toBe(incoming);
  });

  it('merges a refreshed latest page into history that was already prepended', () => {
    const current = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }));
    const incoming = Array.from({ length: 50 }, (_, index) => ({ id: index + 52 }));

    const reconciled = reconcilePersistedSessionMessages(current, incoming);

    expect(reconciled).toHaveLength(101);
    expect(reconciled.map((message) => message.id)).toEqual(
      Array.from({ length: 101 }, (_, index) => index + 1),
    );
  });

  it('retains the full history reference when its latest page is unchanged', () => {
    const current = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }));
    const incoming = Array.from({ length: 50 }, (_, index) => ({ id: index + 51 }));

    expect(reconcilePersistedSessionMessages(current, incoming)).toBe(current);
  });

  it('holds a longer live transcript only while completion reconciliation is active', () => {
    const base = {
      liveMessageCount: 8,
      persistedMessageCount: 5,
      isProcessing: false,
      isLoadingPersistedMessages: false,
    };

    expect(shouldHoldLiveTranscript({
      ...base,
      isCompletionReconcileActive: true,
    })).toBe(true);
    expect(shouldHoldLiveTranscript({
      ...base,
      isCompletionReconcileActive: false,
    })).toBe(false);
  });
});

describe('Pi completion history window', () => {
  const records = (count: number) => Array.from({ length: count }, (_, index) => ({
    id: index,
    role: index === 0 ? 'user' : 'assistant',
    content: index === 0 ? 'Keep my first question' : `Tool activity ${index}`,
  }));
  const pageOf = <T,>(all: T[], limit: number) => ({
    messages: all.slice(-limit), total: all.length, hasMore: all.length > limit,
  });

  it('keeps the first question when a single turn grows past 50 persisted records', async () => {
    const all = records(69);
    const initial = pageOf(all.slice(0, 2), 50);
    const fetchPage = vi.fn(async (limit: number) => pageOf(all, limit));

    const completed = await loadTranscriptWindow({ fetchPage, start: getTranscriptPageStart(initial) });
    const merged = reconcilePersistedSessionMessages(initial.messages, completed.messages);

    expect(merged).toEqual(all);
    expect(merged[0].content).toBe('Keep my first question');
    expect(completed.hasMore).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('covers the first turn even when completion arrives before the initial history read', async () => {
    const all = records(125);
    const completed = await loadTranscriptWindow({
      fetchPage: async (limit) => pageOf(all, limit), start: 0,
    });
    expect(completed.messages).toEqual(all);
  });

  it('keeps already loaded older pages and the next history offset without fetching the whole session', async () => {
    const all = records(420);
    // The user loaded records 100..299 before the next 120 records arrived.
    const loaded = all.slice(100, 300);
    const fetchPage = vi.fn(async (limit: number) => pageOf(all, limit));
    const completed = await loadTranscriptWindow({ fetchPage, start: 100 });
    const merged = reconcilePersistedSessionMessages(loaded, completed.messages);

    expect(merged).toEqual(all.slice(100));
    expect(completed.messages.length).toBe(320);
    expect(getTranscriptPageStart(completed)).toBe(100);
    expect(completed.hasMore).toBe(true);
    expect(fetchPage).toHaveBeenLastCalledWith(320);
  });

  it('does not expand an ordinary first page for an existing session', async () => {
    const all = records(420);
    const fetchPage = vi.fn(async (limit: number) => pageOf(all, limit));
    const initial = await loadTranscriptWindow({ fetchPage, start: null });
    expect(initial.messages).toEqual(all.slice(-50));
    expect(initial.hasMore).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('accounts for records appended between the latest page and the expanded read', async () => {
    const all = records(145);
    let reads = 0;
    const completed = await loadTranscriptWindow({
      fetchPage: async (limit) => pageOf(++reads === 1 ? all.slice(0, 120) : all, limit),
      start: 0,
    });
    expect(completed.messages).toEqual(all);
    expect(completed.hasMore).toBe(false);
  });

  it('keeps older history accessible when a server caps the expanded page size', async () => {
    const all = records(200);
    const fetchPage = vi.fn(async (limit: number) => pageOf(all, Math.min(50, limit)));
    const completed = await loadTranscriptWindow({ fetchPage, start: 0 });
    expect(completed.messages).toEqual(all.slice(-50));
    expect(completed.hasMore).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});
