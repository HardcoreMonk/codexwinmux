import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { HelpCircle, Lock } from 'lucide-react';
import AppLogo from '@/components/layout/app-logo';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useState } from 'react';
import isElectron from '@/hooks/use-is-electron';

interface ILoginFormProps extends React.ComponentProps<'div'> {
  onSuccess?: () => void;
}

export const LoginForm = ({ className, onSuccess, ...props }: ILoginFormProps) => {
  const t = useTranslations('login');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!password) return;

    setIsLoading(true);
    setError('');

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? t('invalidPassword'));
      setIsLoading(false);
    } else if (onSuccess) {
      onSuccess();
    } else {
      window.location.href = '/';
    }
  };

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <div className="flex flex-col gap-10">
        <AppLogo shimmer size="xl" className="justify-center" />
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t('password')}</Label>
            <Input
              id="password"
              type="password"
              placeholder={t('passwordPlaceholder')}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              autoFocus
              className="h-12 text-base"
            />
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <Button type="submit" disabled={isLoading || !password} size="lg" className="h-12 w-full transition-transform duration-200 active:scale-[0.99]">
            <Lock className="size-4" />
            {isLoading ? t('loggingIn') : t('loginButton')}
          </Button>
          <div className="flex items-center justify-center gap-1">
            <Popover>
              <PopoverTrigger className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground transition-colors">
                {t('forgotPassword')}
                <HelpCircle className="h-3 w-3" />
              </PopoverTrigger>
              <PopoverContent className="w-72 text-xs" side="bottom">
                <p className="font-medium mb-1">{t('resetPassword')}</p>
                <p className="text-muted-foreground">
                  {t('resetPasswordHelp', { action: isElectron ? t('restartApp') : t('restartServer') })}
                </p>
                <code className="mt-2 block rounded bg-muted px-2 py-1 font-mono">~/.codexwinmux/config.json</code>
              </PopoverContent>
            </Popover>
          </div>
        </form>
      </div>
    </div>
  );
};
