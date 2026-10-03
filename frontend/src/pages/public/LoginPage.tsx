import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { login } from "@/services/auth.service";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const ok = await login(password);
      if (ok) {
        try {
          localStorage.setItem("isLoggedIn", "true");
        } catch {}
        navigate("/dashboard");
        return;
      }
      setError("Invalid password");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-neutral-950 px-4 transition-colors">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-neutral-100 mb-2">ERM</h1>
          <h2 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-neutral-100">Sign In</h2>
          <p className="text-sm text-gray-500 dark:text-neutral-400 mt-2">
            Manage multi-channel orders and inventory from one place
          </p>
        </div>

        <div className="bg-white dark:bg-neutral-900 px-8 py-8 shadow-sm border border-gray-100 dark:border-neutral-800 rounded-2xl transition-colors">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-neutral-300 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 bg-white dark:bg-neutral-950 text-gray-900 dark:text-neutral-100 border border-gray-200 dark:border-neutral-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-neutral-500 focus:border-transparent transition-all"
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 px-3 py-2 rounded-md border border-red-100 dark:border-red-900/50">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full bg-gray-900 dark:bg-neutral-100 hover:bg-gray-800 dark:hover:bg-white text-white dark:text-neutral-900 transition-colors" disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
