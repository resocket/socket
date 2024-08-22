type Listener<T> = (data: T) => void;

export class CustomEventTarget<EventMap extends object> {
  private _listeners: {
    [key in keyof EventMap]?: Set<Listener<EventMap[key]>>;
  };

  constructor() {
    this._listeners = {};
  }

  addEventListener<K extends keyof EventMap>(
    type: K,
    callback: Listener<EventMap[K]>
  ): void {
    if (!(type in this._listeners)) {
      this._listeners[type] = new Set();
    }
    this._listeners[type]!.add(callback);
  }

  on<K extends keyof EventMap>(type: K, callback: Listener<EventMap[K]>) {
    this.addEventListener(type, callback);
    return () => this.removeEventListener(type, callback);
  }

  removeEventListener<K extends keyof EventMap>(
    type: K,
    callback: Listener<EventMap[K]>
  ): void {
    if (type in this._listeners) {
      this._listeners[type]?.delete(callback);
    }
  }

  dispatchEvent<K extends keyof EventMap>(type: K, detail: EventMap[K]): void {
    if (type in this._listeners) {
      this._listeners[type]?.forEach((listener) => {
        listener(detail);
      });
    }
  }
}
