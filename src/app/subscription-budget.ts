/** Split the server's 256 shared slots so catalog growth cannot evict chat watchers. */
export const MAX_CHAT_SUBSCRIPTIONS = 128;
export const MAX_SURFACE_SUBSCRIPTIONS = 128;

export function liveConversationIds(
  activeId: string | null,
  watchedIds: Iterable<string>,
): Set<string> {
  return new Set(
    [...new Set([...(activeId === null ? [] : [activeId]), ...watchedIds])].slice(
      0,
      MAX_CHAT_SUBSCRIPTIONS,
    ),
  );
}
