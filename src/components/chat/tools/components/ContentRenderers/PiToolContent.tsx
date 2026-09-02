import React from 'react';
import { piRows, piSchedule, piText } from '../../configs/piToolConfigs';
import { requestSimpleBrowserSearch } from '../../../utils/simpleBrowser';
import { getDesktopRuntimeInfo } from '../../../../../utils/desktopRuntime';

// Remote content is text, never HTML/Markdown instructions, embedded media or an automatic navigation.
function Link({ url, label }: { url: any; label?: string }) {
  const text = piText(url);
  let safe = false;
  try { const parsed = new URL(text); safe = ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password; } catch { /* display opaque resource URIs as text */ }
  return safe ? (
    <a
      href={text}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        if (!getDesktopRuntimeInfo().isDesktopShell) return;
        event.preventDefault();
        requestSimpleBrowserSearch(text);
      }}
      className="text-blue-600 underline break-all"
    >
      {label ? `${label} · ${text}` : text}
    </a>
  ) : <span className="break-all">{text}</span>;
}
const Text = ({ value }: { value: any }) => <pre className="whitespace-pre-wrap break-words text-xs font-sans">{piText(value)}</pre>;
const Badge = ({ value }: { value: any }) => <span className="rounded border px-1.5 py-0.5 text-xs">{piText(value)}</span>;

export function PiToolContent({ kind, data, isError }: { kind: string; data: any; isError: boolean }) {
  if (isError) return <div role="alert" className="text-red-600"><Text value={data} /></div>;
  if (!data || typeof data !== 'object') return <Text value={data || '(无输出)'} />;
  if (['browser', 'web', 'call', 'authorization'].includes(kind) || data.authorizationUrl) return <div className="space-y-2 text-xs">
    {data.untrusted && <span className="text-gray-500">外部内容 · 不可信数据</span>}
    {data.status && <Badge value={data.status === 'closed' ? '已关闭' : data.status} />}
    {data.url && <div><Link url={data.url} /></div>}
    {data.page_id && <div>页面：{piText(data.page_id)}</div>}
    {data.text && <Text value={data.text} />}
    {data.authorizationUrl && <div>请核对后手动授权：<Link url={data.authorizationUrl} /></div>}
    {Array.isArray(data.elements) && data.elements.length > 0 && <table className="w-full text-left"><thead><tr><th>编号</th><th>元素</th><th>名称</th></tr></thead><tbody>{data.elements.map((element: any, i: number) => <tr key={i}><td>{piText(element.index)}</td><td>{piText(element.tag)}</td><td>{piText(element.label)}</td></tr>)}</tbody></table>}
    {[...(Array.isArray(data.links) ? data.links : []), ...(Array.isArray(data.resources) ? data.resources : [])].map((link: any, i: number) => <div key={i}><Link url={link.uri || link.url || link} label={link.name} />{link.mimeType && <span> ({piText(link.mimeType)})</span>}</div>)}
    {data.images?.length > 0 && <p>{data.images.length} 张图片（未自动加载）</p>}
    {!data.text && !data.url && !data.status && !data.resources && <Text value={data} />}
  </div>;
  if (kind === 'automation') return <ul className="space-y-2 text-xs">{piRows(data).map((row, i) => <li key={i}><strong>{piText(row.title || row.id)}</strong> <Badge value={row.status} /><div>{piSchedule(row)}</div><div className="text-gray-500">{piText(row.id)}</div></li>)}</ul>;
  if (kind === 'tools' || kind === 'integrations' || kind === 'terminals') return <ul className="space-y-2 text-xs">{piRows(data).map((row, i) => <li key={i}>
    <strong>{piText(row.name || row.title || row.terminal_id || row.id)}</strong> {row.status && <Badge value={row.status} />}
    {row.exitCode != null && <span> · exit {piText(row.exitCode)}</span>}
    {row.type && <span> · {piText(row.type)} · {row.installed ? '已安装' : '未安装'}</span>}
    {row.description && <Text value={row.description} />}{row.output && <Text value={row.output} />}
  </li>)}</ul>;
  if (kind === 'schema') return <div className="space-y-2"><strong>{piText(data.name)}</strong><Text value={data.description} /><details><summary>参数 schema</summary><Text value={data.parameters || data.inputSchema} /></details></div>;
  if (kind === 'memory') return <div className="space-y-2">
    {data.message && <Text value={data.message} />}
    {data.source && <div className="text-xs">来源：{piText(data.source)}</div>}
    {data.memories?.map((row: any, i: number) => <div key={i}><Badge value={row.scope} /><Text value={row.content} /></div>)}
    {data.projectMemory && <Text value={data.projectMemory} />}
    {data.memory && <Text value={data.memory.content} />}
    {!data.memories && !data.memory && !data.message && <Text value={data} />}
  </div>;
  return <Text value={data} />;
}
