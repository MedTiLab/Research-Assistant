import { describe, expect, it } from 'vitest';
import { emptyPiMcpForm, parsePiMcpJson } from './piMcpForm';

describe('Pi MCP JSON import', () => {
  it('accepts a named single-server object and a bare URL configuration', () => {
    expect(parsePiMcpJson('{"mcpServers":{"research":{"url":"https://example.com/mcp"}}}'))
      .toEqual({ ...emptyPiMcpForm(), id: 'research', url: 'https://example.com/mcp' });
    expect(parsePiMcpJson('{"url":"https://example.com/mcp","enabled":false}'))
      .toMatchObject({ id: 'example.com', enabled: false });
    expect(parsePiMcpJson('{"url":"https://example.com/mcp","enabled":true}'))
      .toMatchObject({ id: 'example.com', enabled: false });
  });
  it.each([
    ['{', 'invalidJson'], ['null', 'invalidJson'], ['[]', 'invalidJson'],
    ['{"mcpServers":{"a":null}}', 'invalidJson'],
    ['{"mcpServers":{"a":{},"b":{}}}', 'oneServer'],
    ['{"command":"npx","args":["untrusted"]}', 'useBundle'],
    ['{"type":"sse","url":"https://example.com"}', 'httpOnly'],
    ['{"url":"http://example.com"}', 'httpsRequired'],
    ['{"url":"https://user:secret@example.com"}', 'httpsRequired'],
    ['{"url":"https://example.com","headers":{"Authorization":"secret"}}', 'unsupportedCredentials'],
    ['{"url":"https://example.com","enabled":"false"}', 'invalidJson'],
    ['{"id":"bad name","url":"https://example.com"}', 'invalidName'],
  ])('rejects unsupported or unsafe input %s', (source, error) => {
    expect(() => parsePiMcpJson(source)).toThrow(error);
  });
});
