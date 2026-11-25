import type { BrowserContext, Page } from '@playwright/test';

export interface AlertSpyOptions {
  supportVibrate?: boolean;
}

export interface AlertTelemetry {
  alertTexts: string[];
  domAudioCount: number | null;
  domVibrateCount: number | null;
  appStats: {
    audioCount?: number;
    vibrateCount?: number;
    visualCount?: number;
    lastSeq?: number;
  } | null;
  mediaSpy: {
    vibrateCalls: Array<number | number[]>;
    audioConstructed: number;
    oscillatorsStarted: number;
    bufferSourcesStarted: number;
    resumed: number;
  };
}

export async function installAlertMediaSpy(
  target: Page | BrowserContext,
  options: AlertSpyOptions = {},
): Promise<void> {
  const supportVibrate = options.supportVibrate ?? true;

  await target.addInitScript(
    ({ enableVibrate }: { enableVibrate: boolean }) => {
      const spy = {
        vibrateCalls: [] as Array<number | number[]>,
        audioConstructed: 0,
        oscillatorsStarted: 0,
        bufferSourcesStarted: 0,
        resumed: 0,
      };
      (window as unknown as Record<string, unknown>).__examqTestMediaSpy = spy;

      // 1. Spy or disable Navigator.prototype.vibrate
      if (!enableVibrate) {
        try {
          delete (Navigator.prototype as { vibrate?: unknown }).vibrate;
          delete (navigator as { vibrate?: unknown }).vibrate;
        } catch {
          try {
            Object.defineProperty(Navigator.prototype, 'vibrate', {
              configurable: true,
              writable: true,
              value: undefined,
            });
            Object.defineProperty(navigator, 'vibrate', {
              configurable: true,
              writable: true,
              value: undefined,
            });
          } catch {
            // Ignore if non-configurable in a specific engine
          }
        }
      } else {
        const origVibrate =
          typeof navigator.vibrate === 'function'
            ? navigator.vibrate.bind(navigator)
            : null;
        Object.defineProperty(Navigator.prototype, 'vibrate', {
          configurable: true,
          writable: true,
          value: function (pattern: number | number[]) {
            spy.vibrateCalls.push(
              Array.isArray(pattern) ? [...pattern] : pattern,
            );
            try {
              return origVibrate ? origVibrate(pattern) : true;
            } catch {
              return true;
            }
          },
        });
      }

      // 2. Prototype-preserving Web Audio API spy
      const win = window as unknown as Record<string, unknown>;
      const OrigAC = (win.AudioContext || win.webkitAudioContext) as
        | (new (...args: unknown[]) => AudioContext)
        | undefined;
      if (OrigAC) {
        const WrappedAC = function (
          this: unknown,
          ...args: unknown[]
        ): AudioContext {
          spy.audioConstructed += 1;
          const ac = new OrigAC(...args);

          const origCreateOsc = ac.createOscillator.bind(ac);
          ac.createOscillator = function () {
            const osc = origCreateOsc();
            const origStart = osc.start.bind(osc);
            osc.start = function (...sArgs: Parameters<typeof osc.start>) {
              spy.oscillatorsStarted += 1;
              return origStart(...sArgs);
            };
            return osc;
          };

          const origCreateBuf = ac.createBufferSource.bind(ac);
          ac.createBufferSource = function () {
            const src = origCreateBuf();
            const origStart = src.start.bind(src);
            src.start = function (...sArgs: Parameters<typeof src.start>) {
              spy.bufferSourcesStarted += 1;
              return origStart(...sArgs);
            };
            return src;
          };

          const origResume = ac.resume.bind(ac);
          ac.resume = function () {
            spy.resumed += 1;
            return origResume();
          };

          return ac;
        } as unknown as typeof AudioContext;

        WrappedAC.prototype = OrigAC.prototype;
        win.AudioContext = WrappedAC;
        win.webkitAudioContext = WrappedAC;
      }
    },
    { enableVibrate: supportVibrate },
  );
}

export async function readAlertTelemetry(page: Page): Promise<AlertTelemetry> {
  return page.evaluate(() => {
    const alerts = Array.from(document.querySelectorAll('[role="alert"]'));
    const alertTexts = alerts
      .map((el) => (el.textContent || '').trim())
      .filter((t) => t.length > 0);

    const audioEl = document.querySelector('[data-audio-alert-count]');
    const vibrateEl = document.querySelector('[data-vibrate-alert-count]');
    const domAudioCount = audioEl
      ? Number(audioEl.getAttribute('data-audio-alert-count'))
      : null;
    const domVibrateCount = vibrateEl
      ? Number(vibrateEl.getAttribute('data-vibrate-alert-count'))
      : null;

    const win = window as unknown as Record<string, unknown>;
    const appStats =
      (win.__examqAlertStats as AlertTelemetry['appStats']) ?? null;
    const mediaSpy = (win.__examqTestMediaSpy as AlertTelemetry['mediaSpy']) ?? {
      vibrateCalls: [],
      audioConstructed: 0,
      oscillatorsStarted: 0,
      bufferSourcesStarted: 0,
      resumed: 0,
    };

    return {
      alertTexts,
      domAudioCount: Number.isFinite(domAudioCount) ? domAudioCount : null,
      domVibrateCount: Number.isFinite(domVibrateCount)
        ? domVibrateCount
        : null,
      appStats,
      mediaSpy: {
        vibrateCalls: [...mediaSpy.vibrateCalls],
        audioConstructed: mediaSpy.audioConstructed,
        oscillatorsStarted: mediaSpy.oscillatorsStarted,
        bufferSourcesStarted: mediaSpy.bufferSourcesStarted,
        resumed: mediaSpy.resumed,
      },
    };
  });
}

export function effectiveAudioCount(t: AlertTelemetry): number {
  return Math.max(
    t.domAudioCount ?? 0,
    t.appStats?.audioCount ?? 0,
    t.mediaSpy.oscillatorsStarted + t.mediaSpy.bufferSourcesStarted,
  );
}

export function effectiveVibrateCount(t: AlertTelemetry): number {
  return Math.max(
    t.domVibrateCount ?? 0,
    t.appStats?.vibrateCount ?? 0,
    t.mediaSpy.vibrateCalls.length,
  );
}
