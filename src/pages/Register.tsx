import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { UserPlus, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../stores/auth';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

export function Register() {
  const navigate = useNavigate();
  const { register, loading } = useAuth();
  const [form, setForm] = useState({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    display_name: '',
    party_affiliation: '',
    jurisdiction_state: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    try {
      await register({
        email: form.email,
        username: form.username,
        password: form.password,
        display_name: form.display_name || form.username,
        party_affiliation: form.party_affiliation || undefined,
        jurisdiction_state: form.jurisdiction_state || undefined,
      });
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const update = (field: string, value: string) => setForm({ ...form, [field]: value });

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-lg font-black text-white mx-auto mb-4 shadow-lg shadow-indigo-500/20">A</div>
          <h1 className="text-2xl font-bold text-white mb-2">Create your account</h1>
          <p className="text-sm text-zinc-400">Join Arena for transparent political discourse</p>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-sm text-red-400">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="register-username" className="block text-sm font-medium text-zinc-400 mb-1.5">Username</label>
              <input
                id="register-username"
                required
                autoFocus
                placeholder="johndoe"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                value={form.username}
                onChange={e => update('username', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="register-display-name" className="block text-sm font-medium text-zinc-400 mb-1.5">Display Name</label>
              <input
                id="register-display-name"
                placeholder="John Doe"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                value={form.display_name}
                onChange={e => update('display_name', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label htmlFor="register-email" className="block text-sm font-medium text-zinc-400 mb-1.5">Email</label>
            <input
              id="register-email"
              type="email"
              required
              placeholder="you@example.com"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
              value={form.email}
              onChange={e => update('email', e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="register-password" className="block text-sm font-medium text-zinc-400 mb-1.5">Password</label>
            <div className="relative">
              <input
                id="register-password"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                placeholder="Min. 8 chars, upper+lower+number+symbol"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 pr-10 text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                value={form.password}
                onChange={e => update('password', e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="register-confirm-password" className="block text-sm font-medium text-zinc-400 mb-1.5">Confirm Password</label>
            <input
              id="register-confirm-password"
              type={showPassword ? 'text' : 'password'}
              required
              placeholder="Re-enter password"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
              value={form.confirmPassword}
              onChange={e => update('confirmPassword', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="register-party" className="block text-sm font-medium text-zinc-400 mb-1.5">Party (Optional)</label>
              <select
                id="register-party"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                value={form.party_affiliation}
                onChange={e => update('party_affiliation', e.target.value)}
              >
                <option value="">None / Prefer not to say</option>
                <option value="Democrat">Democrat</option>
                <option value="Republican">Republican</option>
                <option value="Independent">Independent</option>
                <option value="Libertarian">Libertarian</option>
                <option value="Green">Green</option>
              </select>
            </div>
            <div>
              <label htmlFor="register-state" className="block text-sm font-medium text-zinc-400 mb-1.5">State (Optional)</label>
              <select
                id="register-state"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                value={form.jurisdiction_state}
                onChange={e => update('jurisdiction_state', e.target.value)}
              >
                <option value="">Select state</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white font-medium rounded-lg transition-colors"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                Create Account
              </>
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500">
          Already have an account?{' '}
          <Link to="/login" className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
