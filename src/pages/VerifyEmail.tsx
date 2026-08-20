import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertCircle, CheckCircle2, MailCheck } from 'lucide-react';
import * as api from '../api';
import { useAuth } from '../stores/auth';

export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { user, refresh } = useAuth();
  const [state, setState] = useState<'verifying' | 'done' | 'error' | 'idle'>(token ? 'verifying' : 'idle');
  const [error, setError] = useState('');
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;
    api.verifyEmail(token)
      .then(() => {
        setState('done');
        // Refresh the session user so verification_status updates everywhere
        void refresh();
      })
      .catch((err: any) => {
        setError(err.response?.data?.error || err.message || 'Verification failed');
        setState('error');
      });
  }, [token, refresh]);

  const resend = async () => {
    setResending(true);
    setError('');
    try {
      await api.resendVerification();
      setResent(true);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Could not send verification email');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/20">
          <MailCheck className="w-6 h-6 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Email verification</h1>

        {state === 'verifying' && (
          <p className="text-sm text-zinc-400">Verifying your email…</p>
        )}

        {state === 'done' && (
          <>
            <div className="mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center gap-2 text-sm text-emerald-300">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              Email verified. Voter actions are unlocked.
            </div>
            <Link to="/" className="inline-block mt-6 text-sm text-indigo-400 hover:text-indigo-300">Back to the arena →</Link>
          </>
        )}

        {state === 'error' && (
          <>
            <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center gap-2 text-sm text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
            {user && !user.email_verified && (
              <button
                onClick={resend}
                disabled={resending || resent}
                className="mt-6 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium text-white transition-colors"
              >
                {resent ? 'Sent — check your inbox' : resending ? 'Sending…' : 'Send a new verification link'}
              </button>
            )}
          </>
        )}

        {state === 'idle' && (
          <>
            <p className="text-sm text-zinc-400">
              {user
                ? user.email_verified
                  ? 'Your email is already verified.'
                  : 'Your email is not verified yet. Verification unlocks voter actions: saving priorities, asking questions, and voting on questions.'
                : 'Open the verification link from your email, or sign in to request a new one.'}
            </p>
            {user && !user.email_verified && (
              <button
                onClick={resend}
                disabled={resending || resent}
                className="mt-6 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium text-white transition-colors"
              >
                {resent ? 'Sent — check your inbox' : resending ? 'Sending…' : 'Send verification email'}
              </button>
            )}
            {!user && (
              <Link to="/login" className="inline-block mt-6 text-sm text-indigo-400 hover:text-indigo-300">Sign in →</Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}
