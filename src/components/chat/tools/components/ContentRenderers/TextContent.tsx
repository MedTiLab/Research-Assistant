import React from 'react';
import { Markdown } from '../../../view/subcomponents/Markdown';
import { formatProjectRelativePaths } from '../../../utils/projectPathDisplay';

interface TextContentProps {
  content: string;
  format?: 'plain' | 'json' | 'code';
  className?: string;
  onFileOpen?: (filePath: string) => void;
  projectName?: string;
  projectRoot?: string;
}

/**
 * Renders plain text, JSON, or code content
 * Used by: Raw parameters, generic text results, JSON responses
 */
export const TextContent: React.FC<TextContentProps> = ({
  content,
  format = 'plain',
  className = '',
  onFileOpen,
  projectName,
  projectRoot,
}) => {
  const displayContent = formatProjectRelativePaths(content, projectRoot);

  if (format === 'json') {
    let formattedJson = displayContent;
    try {
      const parsed = JSON.parse(displayContent);
      formattedJson = JSON.stringify(parsed, null, 2);
    } catch (e) {
      // If parsing fails, use original content
    }

    return (
      <pre className={`mt-1 text-xs bg-gray-900 dark:bg-gray-950 text-gray-100 p-2.5 rounded overflow-x-auto font-mono ${className}`}>
        {formattedJson}
      </pre>
    );
  }

  if (format === 'code') {
    return (
      <pre className={`mt-1 text-xs bg-gray-50 dark:bg-gray-800/50 border border-gray-200/50 dark:border-gray-700/50 p-2 rounded whitespace-pre-wrap break-words overflow-hidden text-gray-700 dark:text-gray-300 font-mono ${className}`}>
        {displayContent}
      </pre>
    );
  }

  // Plain text
  return (
    <Markdown
      className={`mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap ${className}`}
      onFileOpen={onFileOpen}
      projectName={projectName}
      projectRoot={projectRoot}
    >
      {displayContent}
    </Markdown>
  );
};
