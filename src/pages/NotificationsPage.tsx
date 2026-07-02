import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Bell, CheckCheck } from "lucide-react";
import * as api from "../api";
import { useAuth } from "../stores/auth";
import { formatDistanceToNow } from "date-fns";

export function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { navigate("/login"); return; }
    api.getNotifications()
      .then(data => setNotifications(data.notifications || data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  const handleMarkAllRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
    } catch {}
  };

  const handleClick = async (notif: any) => {
    if (!notif.is_read) {
      try {
        await api.markNotificationRead(notif.id);
        setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: 1 } : n));
      } catch {}
    }
    // Only follow internal app paths — never external or protocol-relative URLs
    if (notif.link_url && notif.link_url.startsWith('/') && !notif.link_url.startsWith('//')) {
      navigate(notif.link_url);
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white">Notifications</h1>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            <CheckCheck className="w-4 h-4" />
            Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="p-12 text-center border border-zinc-800 rounded-2xl bg-zinc-900/30">
          <Bell className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
          <div className="text-zinc-400 mb-2">No notifications yet</div>
          <div className="text-sm text-zinc-500">Subscribe to races and candidates to receive updates.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map(notif => (
            <button
              key={notif.id}
              onClick={() => handleClick(notif)}
              className={`w-full text-left p-4 rounded-xl border transition-colors ${
                notif.is_read
                  ? "border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/50"
                  : "border-indigo-500/20 bg-indigo-950/10 hover:bg-indigo-950/20"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${notif.is_read ? "opacity-0" : "bg-indigo-500"}`} />
                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${notif.is_read ? "text-zinc-400" : "text-white font-semibold"}`}>
                    {notif.title}
                  </div>
                  {notif.body && (
                    <div className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{notif.body}</div>
                  )}
                  <div className="text-xs text-zinc-600 mt-1">
                    {notif.created_at ? formatDistanceToNow(new Date(notif.created_at), { addSuffix: true }) : ""}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
