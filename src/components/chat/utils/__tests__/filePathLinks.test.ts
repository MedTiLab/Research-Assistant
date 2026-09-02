import { describe, expect, it } from 'vitest';

import { isLikelyChatFilePath, normalizeChatFilePath, splitChatFilePathText } from '../filePathLinks';

describe('chat file path links', () => {
  it('normalizes local markdown links with file URLs, encoded spaces, fragments, and line suffixes', () => {
    expect(normalizeChatFilePath('file:///Users/demo/project/docs/My%20Report.md#L12')).toBe('/Users/demo/project/docs/My Report.md');
    expect(normalizeChatFilePath('<outputs/table.csv:24>')).toBe('outputs/table.csv');
    expect(normalizeChatFilePath('./docs/result.pdf?page=2')).toBe('./docs/result.pdf');
    expect(normalizeChatFilePath('docs/deleted-report.md:17')).toBe('docs/deleted-report.md');
  });

  it('detects document, data, and archive paths used in chat responses', () => {
    expect(isLikelyChatFilePath('/Users/demo/project/report.docx')).toBe(true);
    expect(isLikelyChatFilePath('outputs/data.csv')).toBe(true);
    expect(isLikelyChatFilePath('artifacts/bundle.zip')).toBe(true);
    expect(isLikelyChatFilePath('docs/summary.md#L4')).toBe(true);
    expect(isLikelyChatFilePath('https://example.com/report.md')).toBe(false);
  });

  it('splits bare file paths from generated chat text without linking normal URLs', () => {
    expect(splitChatFilePathText('Updated src/components/chat/view/subcomponents/Markdown.tsx and docs/summary.md:17.')).toEqual([
      { type: 'text', value: 'Updated ' },
      {
        type: 'file',
        value: 'src/components/chat/view/subcomponents/Markdown.tsx',
        href: 'src/components/chat/view/subcomponents/Markdown.tsx',
      },
      { type: 'text', value: ' and ' },
      { type: 'file', value: 'docs/summary.md:17', href: 'docs/summary.md' },
      { type: 'text', value: '.' },
    ]);

    expect(splitChatFilePathText('See https://example.com/report.md for context.')).toEqual([
      { type: 'text', value: 'See https://example.com/report.md for context.' },
    ]);
  });
});
