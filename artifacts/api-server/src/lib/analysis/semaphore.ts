// 동시성 제어용 세마포어 — Gemini 호출·파이프라인 실행 수 제한에 사용
// ─── 동시성 제어 — Semaphore ─────────────────────────────────────────────────
class Semaphore {
  private _count: number;
  private _queue: Array<() => void> = [];
  constructor(private readonly max: number) { this._count = max; }
  acquire(): Promise<void> {
    if (this._count > 0) { this._count--; return Promise.resolve(); }
    return new Promise(resolve => this._queue.push(resolve));
  }
  release(): void {
    if (this._queue.length > 0) { this._queue.shift()!(); }
    else { this._count++; }
  }
  get waiting() { return this._queue.length; }
  get active() { return this.max - this._count; }
}

export { Semaphore };
