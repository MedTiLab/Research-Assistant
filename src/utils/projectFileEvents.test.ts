import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PROJECT_FILE_DELETED_EVENT,
  dispatchProjectFileDeleted,
} from './projectFileEvents';

describe('project file events', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispatches deleted file details so open project views can refresh', () => {
    class TestCustomEvent<T> extends Event {
      detail: T;

      constructor(type: string, init: CustomEventInit<T>) {
        super(type);
        this.detail = init.detail as T;
      }
    }

    const dispatchEvent = vi.fn((_event: Event) => true);
    vi.stubGlobal('CustomEvent', TestCustomEvent);
    vi.stubGlobal('window', { dispatchEvent });

    const detail = {
      projectName: 'demo-project',
      relativePath: 'figures/chart.png',
      absolutePath: '/workspace/demo-project/figures/chart.png',
      name: 'chart.png',
    };

    dispatchProjectFileDeleted(detail);

    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const event = dispatchEvent.mock.calls[0][0] as CustomEvent<typeof detail>;
    expect(event.type).toBe(PROJECT_FILE_DELETED_EVENT);
    expect(event.detail).toEqual(detail);
  });
});
