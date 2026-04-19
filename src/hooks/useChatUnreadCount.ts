/**
 * Subscribe to the signed-in user's chat threads and derive the count of
 * threads that have unread messages from someone else. Used to paint a
 * badge on the Team Chat entries in the sidebar and the bottom nav.
 *
 * Implementation notes:
 *   - Reuses `subscribeMyThreads` so both the sidebar and the Chat page
 *     share Firestore's listener cache (one network subscription).
 *   - Returns 0 when no user is signed in or while loading.
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { countUnreadThreads, subscribeMyThreads } from "@/lib/chat";

export function useChatUnreadCount(): number {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setCount(0);
      return;
    }
    return subscribeMyThreads(user.uid, (threads) => {
      setCount(countUnreadThreads(threads, user.uid));
    });
  }, [user]);

  return count;
}
