'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { authApi } from '@/lib/api';
import { saveTokens, getRoleFromToken } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('יש להזין כתובת אימייל');
      return;
    }
    if (!password) {
      setError('יש להזין סיסמה');
      return;
    }

    setLoading(true);
    try {
      const tokens = await authApi.login(email, password);
      saveTokens(tokens.access_token, tokens.refresh_token);

      const role = getRoleFromToken(tokens.access_token);
      if (role === 'admin') {
        router.push('/admin/dashboard');
      } else if (role === 'corporation') {
        router.push('/corporation/dashboard');
      } else {
        router.push('/contractor/dashboard');
      }
    } catch {
      setError('אימייל או סיסמה שגויים');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        {/* Brand strip */}
        <div className="h-2 rounded-t-xl bg-gradient-to-e from-brand-600 to-brand-400" />

        <Card className="rounded-t-none shadow-md">
          <CardHeader className="text-center pb-2">
            <div className="text-3xl font-bold text-brand-600 mb-1">שיבוץ</div>
            <CardTitle className="text-xl">כניסה למערכת</CardTitle>
            <CardDescription>הזינו את פרטי הכניסה שלכם</CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              <Input
                label="כתובת אימייל"
                type="email"
                placeholder="example@company.co.il"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                dir="ltr"
              />
              <Input
                label="סיסמה"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                dir="ltr"
              />

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 text-start">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                size="lg"
                disabled={loading}
                className="w-full mt-1"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>מתחבר...</span>
                  </>
                ) : (
                  'כניסה'
                )}
              </Button>
            </form>

            <div className="mt-6 pt-4 border-t border-slate-100 flex flex-col gap-2 text-sm text-center text-slate-600">
              <p>
                קבלן?{' '}
                <Link
                  href="/register/contractor"
                  className="text-brand-600 font-medium hover:underline"
                >
                  הירשם כאן
                </Link>
              </p>
              <p>
                תאגיד?{' '}
                <Link
                  href="/register/corporation"
                  className="text-brand-600 font-medium hover:underline"
                >
                  הירשמו כאן
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
