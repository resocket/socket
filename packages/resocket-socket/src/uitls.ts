import { TimeoutError } from "./errors";
import { CloseEvent, ErrorEvent } from "./events";

export const timeoutPromise = <T = unknown>(
  func: Promise<T>,
  timeout: number,
  timeoutErrMsg: string
): Promise<T> => {
  return new Promise((resolve, reject) => {
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise((_resolve, _reject) => {
      timeoutId = setTimeout(() => {
        _reject(new TimeoutError(timeoutErrMsg));
      }, timeout);
    });

    Promise.race([func, timeoutPromise])
      .then((data) => {
        resolve(data as T);
      })
      .catch((error) => {
        reject(error);
      })
      .finally(() => {
        clearTimeout(timeoutId);
      });
  });
};

function cloneEventBrowser(e: Event) {
  return new (e as any).constructor(e.type, e) as Event;
}

function cloneEventNode(e: Event) {
  if ("data" in e) {
    const evt = new MessageEvent(e.type, e);
    return evt;
  }

  if ("code" in e || "reason" in e) {
    const evt = new CloseEvent(
      // @ts-expect-error we need to fix event/listener types
      (e.code || 1999) as number,
      // @ts-expect-error we need to fix event/listener types
      (e.reason || "unknown reason") as string,
      e
    );
    return evt;
  }

  if ("error" in e) {
    const evt = new ErrorEvent(e.error as Error, e);
    return evt;
  }

  const evt = new Event(e.type, e);
  return evt;
}

const isNode =
  typeof process !== "undefined" &&
  typeof process.versions?.node !== "undefined" &&
  typeof document === "undefined";

export const cloneEvent = isNode ? cloneEventNode : cloneEventBrowser;
