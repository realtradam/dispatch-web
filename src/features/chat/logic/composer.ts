/** Stop still uses the same action; the backend carries queued input into a new turn. */
export function stopButtonLabels(queuedMessageCount: number | undefined) {
  if (queuedMessageCount !== undefined && queuedMessageCount >= 1) {
    return {
      text: "Interrupt & send queued",
      ariaLabel: "Interrupt & send queued",
      title: "Stop the current response and start the queued message now",
    };
  }
  return { text: "Stop", ariaLabel: "Stop generation", title: undefined };
}
