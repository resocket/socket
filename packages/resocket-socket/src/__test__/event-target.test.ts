import { describe, it, expect } from "vitest";
import { CustomEventTarget } from "../event-target";

//todo complete the test cases
describe("event target", () => {
  class Tester extends CustomEventTarget<any> {}

  it("should test addEventListener", () => {
    const tester = new Tester();

    expect(tester.addEventListener).toBeDefined();

    tester.addEventListener("test", () => {});
    tester.addEventListener("test", () => {});
    tester.addEventListener("test", () => {});

    tester.addEventListener("test2", () => {});

    //@ts-ignore -- accessing private property
    expect(Object.keys(tester._listeners).length).toBe(2);

    //@ts-ignore -- accessing private property
    expect(tester._listeners["test"].size).toBe(3);

    //@ts-ignore -- accessing private property
    expect(tester._listeners["test2"].size).toBe(1);

    //@ts-ignore -- accessing private property
    expect(tester._listeners["stable"]).toBeUndefined();

    const stableListener = () => {};

    tester.addEventListener("stable", stableListener);
    tester.addEventListener("stable", stableListener);
    tester.addEventListener("stable", stableListener);

    //@ts-ignore -- accessing private property
    expect(tester._listeners["stable"].size).toBe(1);
  });

  it("should test removeEventListener", async () => {
    const tester = new Tester();

    const stableListener = () => {};

    tester.addEventListener("stable", stableListener);
    tester.addEventListener("stable", stableListener);
    tester.addEventListener("stable", stableListener);

    //@ts-ignore -- accessing private property
    expect(tester._listeners["stable"].size).toBe(1);

    tester.removeEventListener("stable", () => {});
    tester.removeEventListener("random", () => {});

    //@ts-ignore -- accessing private property
    expect(tester._listeners["stable"].size).toBe(1);

    tester.removeEventListener("stable", stableListener);

    //@ts-ignore -- accessing private property
    expect(tester._listeners["stable"].size).toBe(0);
  });

  it("should test dispatchEvent", () => {
    const tester = new Tester();

    let count = 0;
    const stableListener = () => {
      count++;
    };

    tester.addEventListener("stable", stableListener);

    tester.dispatchEvent("ssss", undefined);

    expect(count).toBe(0);

    tester.dispatchEvent("stable", undefined);
    tester.dispatchEvent("stable", undefined);
    tester.dispatchEvent("stable", undefined);
    tester.dispatchEvent("stable", undefined);
    tester.dispatchEvent("stable", undefined);

    expect(count).toBe(5);
  });

  it("should test on", () => {
    const tester = new Tester();

    let count = 0;

    const unsub = tester.on("event", () => {
      count++;
    });

    //@ts-ignore -- accessing private property
    expect(tester._listeners["event"].size).toBe(1);

    tester.dispatchEvent("random", "");

    expect(count).toBe(0);

    tester.dispatchEvent("event", "");
    tester.dispatchEvent("event", "");

    expect(count).toBe(2);

    unsub();

    //@ts-ignore -- accessing private property
    expect(tester._listeners["event"].size).toBe(0);

    tester.dispatchEvent("event", "");
    tester.dispatchEvent("event", "");

    expect(count).toBe(2);
  });
});
