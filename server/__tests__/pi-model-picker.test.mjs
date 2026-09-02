import { describe, expect, it } from 'vitest';

const modelId = 'deepseek/deepseek-v4-pro';
const label = 'DeepSeek / DeepSeek V4 Pro';
const catalogue = [{ value: modelId, label, modelProviderId: 'deepseek', contextLength: 1_000_000 }];

// Real React effects and browser interactions, using an isolated profile and mocked HTTP only.
const browserSuite = process.env.MEDHELP_BROWSER_TESTS === '1' ? describe : describe.skip;
browserSuite('Pi model picker refresh', () => {
  it('remembers a manual model on return, ignores historical model metadata, and drops stale API options', async () => {
    const { build } = await import('esbuild');
    const { chromium } = await import('playwright');
    const { fileURLToPath } = await import('node:url');
    const bundled = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../../src/components/chat/view/subcomponents/', import.meta.url)), loader: 'tsx',
        contents: `
          import React, { useEffect, useState } from 'react';
          import { createRoot } from 'react-dom/client';
          import CustomModelInput from './CustomModelInput';
          import { useChatProviderState } from '../../hooks/useChatProviderState';
          import { applyAuthoritativePiSelection } from '../../utils/piActiveSelection';
          function Chat() {
            const [selectedSession, setSession] = useState(null);
            const state = useChatProviderState({selectedSession});
            useEffect(() => {
              const sync = () => applyAuthoritativePiSelection(window.availability, {
                storage: localStorage, setModelId: state.setPiModel,
                setModelProviderId: state.setPiModelProviderId, setModelApi: state.setPiModelApi,
              });
              sync();
              window.addEventListener('pi-provider-config-changed', sync);
              return () => window.removeEventListener('pi-provider-config-changed', sync);
            }, []);
            return <>
              <button id="history" onClick={() => setSession({id:'old', __provider:'pi', modelId:'old-raw-model', modelProviderId:'byok-openai-compatible'})}>Open history</button>
              <output id="selection">{state.piModel}</output>
              <CustomModelInput value={state.piModel} endpoint="/api/pi/models" allowCustom={false}
                selectedModelProviderId={state.piModelProviderId}
                options={[{value:state.piModel, label:state.piModel, modelProviderId:state.piModelProviderId}]}
                onChange={value => { state.setPiModel(value); localStorage.setItem('pi-model', value); }}
                onOptionChange={model => {
                  state.setPiModelProviderId(model.modelProviderId); state.setPiModelApi(model.modelApi);
                  localStorage.setItem('pi-model-provider', model.modelProviderId); localStorage.setItem('pi-model-api', model.modelApi);
                }} />
            </>;
          }
          function Fixture() {
            const [visible, setVisible] = useState(true);
            return <><button id="navigate" onClick={() => setVisible(v => !v)}>Navigate</button>{visible && <Chat />}</>;
          }
          createRoot(document.getElementById('root')).render(<Fixture />);
        `,
      },
      bundle: true, write: false, format: 'iife', platform: 'browser',
      plugins: [{ name: 'isolated-model-api', setup(builder) {
        builder.onResolve({ filter: /\/(utils\/api|services\/localKernelConnection)$/ }, (args) => ({ path: args.path, namespace: 'fixture-api' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture-api' }, () => ({ contents: 'export const authenticatedFetch = (...args) => fetch(...args); export const getActiveLocalKernel = () => null;' }));
      } }],
    });
    const option = (value) => ({ value, label: value, modelProviderId: 'byok-openai-compatible', modelApi: 'openai-completions' });
    let models = [option('first/default'), option('first/chosen')];
    const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: 'chrome', headless: true }));
    let releaseStale;
    let delayNext = false;
    try {
      const page = await browser.newPage();
      await page.addInitScript((models) => {
        window.availability = { cliAvailable: true, configured: true, modelId: models[0].value, modelProviderId: models[0].modelProviderId, modelApi: models[0].modelApi, models };
      }, models);
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/pi/models') {
          const snapshot = [...models];
          if (delayNext) { delayNext = false; await new Promise(resolve => { releaseStale = resolve; }); }
          await route.fulfill({ json: { models: snapshot } });
        } else if (url.pathname === '/fixture.js') {
          await route.fulfill({ contentType: 'application/javascript', body: bundled.outputFiles[0].text });
        } else {
          await route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script src="/fixture.js"></script>' });
        }
      });
      await page.goto('http://model-navigation.test');
      await page.getByRole('button', { name: 'first/default', exact: true }).click();
      await page.getByRole('button', { name: 'first/chosen', exact: true }).click();
      await page.locator('#navigate').click();
      await page.locator('#navigate').click();
      await page.waitForFunction(() => document.querySelector('#selection')?.textContent === 'first/chosen');
      await page.locator('#history').click();
      expect(await page.locator('#selection').textContent()).toBe('first/chosen');

      // A pending response from the old API must not repopulate its models.
      delayNext = true;
      const pendingRequest = page.waitForRequest('**/api/pi/models');
      await page.getByRole('button', { name: 'first/chosen', exact: true }).click();
      await pendingRequest;
      models = [option('second/default')];
      await page.evaluate((models) => {
        window.availability = { ...window.availability, modelId: models[0].value, models };
        window.dispatchEvent(new Event('pi-provider-config-changed'));
      }, models);
      await page.getByText('second/default', { exact: true }).last().waitFor();
      await page.getByText('Loading...', { exact: true }).waitFor({ state: 'hidden' });
      const staleResponse = page.waitForResponse('**/api/pi/models');
      releaseStale?.();
      await staleResponse;
      await page.evaluate(() => new Promise(requestAnimationFrame));
      await page.getByText('Loading...', { exact: true }).waitFor({ state: 'hidden' });
      expect(await page.getByRole('button', { name: 'first/chosen', exact: true }).count()).toBe(0);
      expect(await page.locator('#selection').textContent()).toBe('second/default');

      // A successful empty catalogue must not reinsert the selected fallback.
      models = [];
      await page.evaluate(() => window.dispatchEvent(new Event('pi-provider-config-changed')));
      await page.getByText('No models found', { exact: true }).waitFor();
      expect(await page.getByText('second/default', { exact: true }).count()).toBe(1); // output only
    } finally {
      releaseStale?.();
      await browser.close();
    }
  }, 30000);

  it('keeps official names across parent renders, selection changes and pending refreshes without a fetch loop', async () => {
    const { build } = await import('esbuild');
    const { chromium } = await import('playwright');
    const { fileURLToPath } = await import('node:url');
    const bundled = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../../src/components/chat/view/subcomponents/', import.meta.url)),
        loader: 'tsx',
        contents: `
          import React, { useState } from 'react';
          import { createRoot } from 'react-dom/client';
          import CustomModelInput from './CustomModelInput';
          function Fixture() {
            const [revision, setRevision] = useState(0);
            const [value, setValue] = useState(${JSON.stringify(modelId)});
            return <><button id="rerender" onClick={() => setRevision(n => n + 1)}>Parent render {revision}</button>
              <CustomModelInput value={value} onChange={setValue} endpoint="/api/pi/models"
                options={[{value, label: value, modelProviderId: 'deepseek'}]}
                selectedModelProviderId="deepseek" allowCustom={false}
                onCatalogChange={() => setRevision(n => n + 1)} />
            </>;
          }
          createRoot(document.getElementById('root')).render(<Fixture />);
        `,
      },
      bundle: true, write: false, format: 'iife', platform: 'browser',
      plugins: [{ name: 'isolated-model-api', setup(builder) {
        builder.onResolve({ filter: /\/(utils\/api|services\/localKernelConnection)$/ }, (args) => ({ path: args.path, namespace: 'fixture-api' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture-api' }, () => ({ contents: 'export const authenticatedFetch = (...args) => fetch(...args); export const getActiveLocalKernel = () => null;' }));
      } }],
    });
    const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: 'chrome', headless: true }));
    let releaseRefresh;
    let requestCount = 0;
    const flashLabel = 'DeepSeek / DeepSeek V4 Flash';
    try {
      const page = await browser.newPage();
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/pi/models') {
          requestCount++;
          if (requestCount === 2) await new Promise((resolve) => { releaseRefresh = resolve; });
          await route.fulfill({ json: { models: [...catalogue, { ...catalogue[0], value: 'deepseek/deepseek-v4-flash', label: flashLabel }] } });
        } else if (url.pathname === '/fixture.js') {
          await route.fulfill({ contentType: 'application/javascript', body: bundled.outputFiles[0].text });
        } else {
          await route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script src="/fixture.js"></script>' });
        }
      });
      await page.goto('http://model-picker.test');
      await page.getByRole('button', { name: modelId, exact: true }).click();
      await page.getByText(label, { exact: true }).waitFor();
      await page.getByText('Loading...', { exact: true }).waitFor({ state: 'hidden' });
      // Dispatch without pointer-down: keep the dropdown open while its parent re-renders.
      await page.locator('#rerender').dispatchEvent('click');
      await page.waitForFunction(() => document.querySelector('#rerender')?.textContent === 'Parent render 2');
      expect(requestCount).toBe(1);
      expect(await page.getByText(label, { exact: true }).count()).toBe(1);

      await page.getByRole('button', { name: new RegExp(flashLabel) }).click();
      await page.getByRole('button', { name: flashLabel, exact: true }).click();
      await page.getByText('Loading...', { exact: true }).waitFor();
      await page.getByText(flashLabel, { exact: true }).waitFor();
      expect(await page.getByText(label, { exact: true }).count()).toBe(1);
      await page.locator('#rerender').dispatchEvent('click');
      await page.waitForFunction(() => document.querySelector('#rerender')?.textContent === 'Parent render 3');
      expect(requestCount).toBe(2);
      releaseRefresh?.();
      await page.getByText('Loading...', { exact: true }).waitFor({ state: 'hidden' });
      expect(await page.getByText(flashLabel, { exact: true }).count()).toBe(1);
      expect(requestCount).toBe(2);
    } finally {
      releaseRefresh?.();
      await browser.close();
    }
  }, 20000);
});
