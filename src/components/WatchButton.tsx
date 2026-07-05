import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { useNavigate } from "react-router";
import { Loader2, Star } from "lucide-react";
import * as api from "../api";
import { useAuth } from "../stores/auth";

type WatchType = "race" | "candidate" | "challenge";

type WatchButtonProps = {
  targetType: WatchType;
  targetId: string;
  label?: string;
  compact?: boolean;
  subscription?: any | null;
  onChange?: (subscription: any | null) => void;
  className?: string;
};

export function WatchButton({
  targetType,
  targetId,
  label,
  compact = false,
  subscription: controlledSubscription,
  onChange,
  className = "",
}: WatchButtonProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [subscription, setSubscription] = useState<any | null>(controlledSubscription ?? null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (controlledSubscription !== undefined) {
      setSubscription(controlledSubscription);
    }
  }, [controlledSubscription]);

  useEffect(() => {
    if (!user || controlledSubscription !== undefined) return;
    let cancelled = false;
    api.getMySubscriptions()
      .then(data => {
        if (cancelled) return;
        setSubscription((data.subscriptions || []).find(sub =>
          sub.subscription_type === targetType && sub.target_id === targetId
        ) || null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id, targetType, targetId, controlledSubscription]);

  const watched = Boolean(subscription);
  const text = label || (watched ? "Watching" : "Watch");

  const setWatchedSubscription = (next: any | null) => {
    setSubscription(next);
    onChange?.(next);
  };

  const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (!user) {
      navigate("/login");
      return;
    }

    setLoading(true);
    try {
      if (subscription) {
        await api.unsubscribe(subscription.id);
        setWatchedSubscription(null);
      } else {
        const next = await api.subscribe({
          subscription_type: targetType,
          target_id: targetId,
          channel: "in_app",
        });
        setWatchedSubscription({
          ...next,
          subscription_type: targetType,
          target_id: targetId,
        });
      }
    } catch (err: any) {
      if (err.response?.status === 409) {
        const data = await api.getMySubscriptions();
        const existing = (data.subscriptions || []).find(sub =>
          sub.subscription_type === targetType && sub.target_id === targetId
        ) || null;
        setWatchedSubscription(existing);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`${compact
        ? "inline-flex h-8 w-8 items-center justify-center rounded-lg"
        : "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
      } border transition-colors ${watched
        ? "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15"
        : "border-zinc-800 bg-zinc-950/80 text-zinc-400 hover:border-zinc-700 hover:text-white"
      } disabled:opacity-60 ${className}`}
      aria-pressed={watched}
      aria-label={watched ? `Stop watching ${targetType}` : `Watch ${targetType}`}
      title={watched ? "Stop watching" : "Watch for updates"}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Star className={`h-4 w-4 ${watched ? "fill-amber-300" : ""}`} />
      )}
      {!compact && <span>{text}</span>}
    </button>
  );
}
