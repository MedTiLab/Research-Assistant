const MINI_APP_CSP = "default-src 'none'; img-src data:; media-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; navigate-to 'none'; base-uri 'none'";

export function sandboxMiniAppHtml(html: string) {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${MINI_APP_CSP}">`;
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
  if (/<html[\s>]/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1><head>${meta}</head>`);
  return `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
}

export const STARTER_MINI_APP = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>研究小工具</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; color: #17312b; background: linear-gradient(135deg,#effcf7,#f8fbff); }
    main { width: min(520px, calc(100% - 32px)); padding: 28px; border: 1px solid #cde8df; border-radius: 20px; background: rgba(255,255,255,.9); box-shadow: 0 20px 60px rgba(20,70,58,.12); }
    button { border: 0; border-radius: 10px; padding: 10px 14px; color: white; background: #147d64; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>研究小工具</h1>
    <p id="message">这是一个可直接编辑的单文件研究应用。</p>
    <button onclick="document.querySelector('#message').textContent='运行正常 ✓'">测试交互</button>
  </main>
</body>
</html>`;
