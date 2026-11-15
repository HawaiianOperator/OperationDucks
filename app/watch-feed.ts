export function watchFeed(refresh: (signal: AbortSignal) => Promise<void>, interval: number) {
  const controller = new AbortController();
  let busy = false;
  const update = async () => {
    if (busy || controller.signal.aborted) return;
    busy = true;
    try {
      await refresh(controller.signal);
    } finally {
      busy = false;
    }
  };
  const onVisible = () => { if (!document.hidden) void update(); };
  void update();
  const timer = window.setInterval(onVisible, interval);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    controller.abort();
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
