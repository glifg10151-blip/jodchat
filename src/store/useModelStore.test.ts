import { beforeEach, describe, expect, it, vi } from "vitest";

const eventMocks = vi.hoisted(() => ({
  listen: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventMocks.listen,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: eventMocks.invoke,
}));

import { useModelStore } from "./useModelStore";

describe("useModelStore stream listeners", () => {
  beforeEach(() => {
    eventMocks.listen.mockReset();
    eventMocks.invoke.mockReset();
    eventMocks.invoke.mockResolvedValue(undefined);
  });

  it("waits for an in-flight listener initialization before resolving additional registrations", async () => {
    let finishFirstListen: ((unlisten: () => void) => void) | undefined;
    const firstListen = new Promise<() => void>((resolve) => {
      finishFirstListen = resolve;
    });
    const unlistenChunk = vi.fn();
    const unlistenDone = vi.fn();

    eventMocks.listen.mockImplementationOnce(() => firstListen).mockResolvedValueOnce(unlistenDone);

    const firstRegistration = useModelStore
      .getState()
      .ensureStreamListeners("stream-1", "conversation-1", vi.fn(), vi.fn());
    const secondRegistration = useModelStore
      .getState()
      .ensureStreamListeners("stream-2", "conversation-2", vi.fn(), vi.fn());
    let secondResolved = false;
    void secondRegistration.then(() => {
      secondResolved = true;
    });

    await Promise.resolve();
    expect(secondResolved).toBe(false);

    finishFirstListen?.(unlistenChunk);
    const [cleanupFirst, cleanupSecond] = await Promise.all([firstRegistration, secondRegistration]);
    expect(secondResolved).toBe(true);
    expect(eventMocks.listen).toHaveBeenCalledTimes(2);

    cleanupFirst();
    cleanupSecond();
    expect(unlistenChunk).toHaveBeenCalledOnce();
    expect(unlistenDone).toHaveBeenCalledOnce();
  });

  it("cleans up a partial registration and allows a later retry", async () => {
    const partialUnlisten = vi.fn();
    eventMocks.listen.mockResolvedValueOnce(partialUnlisten).mockRejectedValueOnce(new Error("done listener failed"));

    await expect(
      useModelStore.getState().ensureStreamListeners("failed-stream", "failed-conversation", vi.fn(), vi.fn()),
    ).rejects.toThrow("done listener failed");
    expect(partialUnlisten).toHaveBeenCalledOnce();

    const retryChunkUnlisten = vi.fn();
    const retryDoneUnlisten = vi.fn();
    eventMocks.listen.mockResolvedValueOnce(retryChunkUnlisten).mockResolvedValueOnce(retryDoneUnlisten);

    const cleanup = await useModelStore
      .getState()
      .ensureStreamListeners("retry-stream", "retry-conversation", vi.fn(), vi.fn());
    cleanup();

    expect(retryChunkUnlisten).toHaveBeenCalledOnce();
    expect(retryDoneUnlisten).toHaveBeenCalledOnce();
  });

  it("routes chunks and completion by stream ID when a conversation has multiple registrations", async () => {
    type ChunkEvent = { payload: { streamId: string; content: string; kind?: "content" | "reasoning" } };
    type DoneEvent = { payload: { streamId: string } };
    let emitChunk!: (event: ChunkEvent) => void;
    let emitDone!: (event: DoneEvent) => void;
    eventMocks.listen.mockImplementation((eventName: string, handler: unknown) => {
      if (eventName === "chat-stream-chunk") emitChunk = handler as (event: ChunkEvent) => void;
      if (eventName === "chat-stream-done") emitDone = handler as (event: DoneEvent) => void;
      return Promise.resolve(vi.fn());
    });

    const firstChunk = vi.fn();
    const secondChunk = vi.fn();
    const firstDone = vi.fn();
    const secondDone = vi.fn();
    const cleanupFirst = await useModelStore
      .getState()
      .ensureStreamListeners("stream-a", "shared-conversation", firstChunk, firstDone);
    const cleanupSecond = await useModelStore
      .getState()
      .ensureStreamListeners("stream-b", "shared-conversation", secondChunk, secondDone);
    useModelStore.getState().setActiveStreamId("stream-a", "shared-conversation");
    useModelStore.getState().setActiveStreamId("stream-b", "shared-conversation");

    emitChunk({ payload: { streamId: "stream-a", content: "first" } });
    emitChunk({ payload: { streamId: "stream-b", content: "second" } });
    emitDone({ payload: { streamId: "stream-a" } });

    expect(firstChunk).toHaveBeenCalledWith({ kind: "content", content: "first" });
    expect(secondChunk).not.toHaveBeenCalled();
    expect(firstDone).toHaveBeenCalledOnce();
    expect(secondDone).not.toHaveBeenCalled();

    emitDone({ payload: { streamId: "stream-b" } });
    expect(secondChunk).toHaveBeenCalledWith({ kind: "content", content: "second" });
    expect(secondDone).toHaveBeenCalledOnce();

    cleanupFirst();
    cleanupSecond();
  });

  it("resolves every active conversation handler when all streams are cancelled", async () => {
    const unlistenChunk = vi.fn();
    const unlistenDone = vi.fn();
    eventMocks.listen.mockResolvedValueOnce(unlistenChunk).mockResolvedValueOnce(unlistenDone);

    const firstDone = vi.fn();
    const secondDone = vi.fn();
    const cleanupFirst = await useModelStore
      .getState()
      .ensureStreamListeners("stream-1", "conversation-1", vi.fn(), firstDone);
    const cleanupSecond = await useModelStore
      .getState()
      .ensureStreamListeners("stream-2", "conversation-2", vi.fn(), secondDone);

    useModelStore.getState().setActiveStreamId("stream-1", "conversation-1");
    useModelStore.getState().setActiveStreamId("stream-2", "conversation-2");
    await useModelStore.getState().cancelActiveStream();

    expect(eventMocks.invoke).toHaveBeenCalledTimes(2);
    expect(eventMocks.invoke).toHaveBeenCalledWith("cancel_chat_stream", { streamId: "stream-1" });
    expect(eventMocks.invoke).toHaveBeenCalledWith("cancel_chat_stream", { streamId: "stream-2" });
    expect(firstDone).toHaveBeenCalledOnce();
    expect(secondDone).toHaveBeenCalledOnce();

    cleanupFirst();
    cleanupSecond();
    expect(unlistenChunk).toHaveBeenCalledOnce();
    expect(unlistenDone).toHaveBeenCalledOnce();
  });
});
