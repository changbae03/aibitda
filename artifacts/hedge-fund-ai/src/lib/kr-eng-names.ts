import { getApiUrl } from "./utils";

const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

export function getKrEngName(ticker: string): Promise<string | null> {
  const code = ticker.replace(/\.(KS|KQ)$/i, "");
  if (!/^\d{6}$/.test(code)) return Promise.resolve(null);

  if (cache.has(code)) return Promise.resolve(cache.get(code) ?? null);
  if (pending.has(code)) return pending.get(code)!;

  const promise = fetch(getApiUrl(`api/market-data/en-name/${code}`))
    .then(r => r.json())
    .then((d: { engName: string | null }) => {
      const name = d.engName ?? null;
      cache.set(code, name);
      pending.delete(code);
      return name;
    })
    .catch(() => {
      cache.set(code, null);
      pending.delete(code);
      return null;
    });

  pending.set(code, promise);
  return promise;
}
