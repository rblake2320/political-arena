import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Bell, MapPin, Star, Swords, UserRound, Vote } from "lucide-react";
import * as api from "../api";
import { WatchButton } from "../components/WatchButton";
import { useAuth } from "../stores/auth";

const typeMeta = {
  race: { label: "Watched Races", icon: Vote },
  candidate: { label: "Watched Candidates", icon: UserRound },
  challenge: { label: "Watched Callouts", icon: Swords },
};

function SubscriptionCard({ subscription, onChange }: { subscription: any; onChange: (next: any | null) => void }) {
  const Icon = typeMeta[subscription.subscription_type as keyof typeof typeMeta]?.icon || Star;
  const target = subscription.target;
  const href = !target ? '/my-arena' : subscription.subscription_type === 'race' ? `/race/${target.id}`
    : subscription.subscription_type === 'candidate' ? `/profile/candidate/${target.id}`
    : `/challenge/${target.public_receipt_slug || target.id}`;
  const label = target?.name || target?.claim_text || target?.challenge_text || 'Unavailable item';
  const location = [target?.state || target?.race_state, target?.office || target?.race_office, target?.district && `District ${target.district}`]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-start justify-between gap-4">
        <Link to={href} className="group flex min-w-0 flex-1 gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-indigo-300">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium text-white group-hover:text-indigo-300">
              {label}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span className="capitalize">{subscription.subscription_type}</span>
              {location && (
                <>
                  <span className="text-zinc-700">/</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {location}
                  </span>
                </>
              )}
              {target?.party && (
                <>
                  <span className="text-zinc-700">/</span>
                  <span>{target?.party}</span>
                </>
              )}
              {(subscription.subscription_type === "challenge" && target?.status) && (
                <>
                  <span className="text-zinc-700">/</span>
                  <span>{(subscription.subscription_type === "challenge" && target?.status)}</span>
                </>
              )}
            </div>
            {subscription.subscription_type === "challenge" && (target?.challenger_name || target?.target_name) && (
              <div className="mt-2 text-xs text-zinc-500">
                {target?.challenger_name} vs {target?.target_name}
              </div>
            )}
          </div>
        </Link>
        <WatchButton
          compact
          targetType={subscription.subscription_type}
          targetId={subscription.target_id}
          subscription={subscription}
          onChange={onChange}
        />
      </div>
    </div>
  );
}

export function MyArenaPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }

    api.getWatchlist()
      .then(data => setSubscriptions(data.subscriptions || []))
      .catch(() => setError("Could not load your watchlist. Reload to retry."))
      .finally(() => setLoading(false));
  }, [user?.id]);

  const grouped = useMemo(() => ({
    race: subscriptions.filter(sub => sub.subscription_type === "race"),
    candidate: subscriptions.filter(sub => sub.subscription_type === "candidate"),
    challenge: subscriptions.filter(sub => sub.subscription_type === "challenge"),
  }), [subscriptions]);

  const handleSubscriptionChange = (id: string, next: any | null) => {
    if (next) {
      setSubscriptions(prev => prev.map(sub => sub.id === id ? { ...sub, ...next } : sub));
    } else {
      setSubscriptions(prev => prev.filter(sub => sub.id !== id));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500/30 border-t-indigo-500" />
      </div>
    );
  }

  const total = subscriptions.length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-indigo-300">
          <Star className="h-4 w-4 fill-indigo-300" />
          My Arena
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Watchlist</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
          Follow races, candidates, and public callouts. Updates appear here and in notifications.
        </p>
      </div>

      {error && <p role="alert" className="mb-4 text-red-300">{error}</p>}
      {!error && total === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-12 text-center">
          <Bell className="mx-auto mb-3 h-8 w-8 text-zinc-600" />
          <div className="mb-2 text-zinc-300">Nothing watched yet</div>
          <div className="mb-6 text-sm text-zinc-500">Use the star buttons on races, candidates, and receipts to build your list.</div>
          <Link to="/" className="inline-flex rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
            Browse Races
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {(Object.keys(typeMeta) as Array<keyof typeof typeMeta>).map(type => {
            const items = grouped[type];
            const Icon = typeMeta[type].icon;
            return (
              <section key={type}>
                <div className="mb-3 flex items-center gap-2">
                  <Icon className="h-4 w-4 text-indigo-300" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                    {typeMeta[type].label}
                  </h2>
                  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">{items.length}</span>
                </div>
                {items.length === 0 ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5 text-sm text-zinc-500">
                    No {typeMeta[type].label.toLowerCase()} yet.
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {items.map(subscription => (
                      <SubscriptionCard
                        key={subscription.id}
                        subscription={subscription}
                        onChange={next => handleSubscriptionChange(subscription.id, next)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
