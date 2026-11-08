import { ExternalDisplay } from "./external_display.ts";

/**
 * A Ulanzi D200 key client listens on this port. 8003 keeps it clear of the sibling
 * receivers: the browser simulator owns 127.0.0.1:8000 and the ESP32 firmware serves port 80.
 * `GENTLE_EMOTE_D200_PORT` overrides it for tests and local experiments.
 */
export const D200_PORT = 8003;

export function resolveD200Port(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.GENTLE_EMOTE_D200_PORT;
  if (raw === undefined || raw.trim() === "") return D200_PORT;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : D200_PORT;
}

export function d200Url(port = resolveD200Port()): string {
  return `http://127.0.0.1:${port}/emote`;
}

/**
 * Independent destination for the D200 key, toggled at runtime by `/emote d200On` and
 * `/emote d200Off`. It is never part of the layered config, so enabling it cannot be
 * persisted by accident and disabling it never touches configured destinations.
 */
export function createD200Display(options: {
  port?: number;
  fetcher?: typeof fetch;
  report?: (message: string) => void;
} = {}): ExternalDisplay {
  const url = d200Url(options.port ?? resolveD200Port());
  return new ExternalDisplay(
    { enabled: true, url, timeoutMs: 1000 },
    options.fetcher ?? fetch,
    options.report ?? (() => {}),
  );
}
