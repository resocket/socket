export class TimeoutError extends Error {
  constructor(msg: string) {
    super(msg);
  }
}

export class StopRetry extends Error {
  constructor(msg: string) {
    super(msg);
  }
}
