import { Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_PUBLIC_DISPLAY_NAME } from '@/lib/app-brand';

interface IAppLogoProps {
  shimmer?: boolean;
  size?: 'sm' | 'xl';
  className?: string;
}

const AppLogo = ({ shimmer = false, size = 'sm', className }: IAppLogoProps) => {
  const iconSize = size === 'xl' ? 'h-6 w-6' : 'h-4 w-4';
  const textSize = size === 'xl' ? 'text-xl' : 'text-sm';
  const publicTitle = `windows native ${APP_PUBLIC_DISPLAY_NAME}`;

  return (
    <div className={cn('flex items-center gap-1.5', size === 'xl' && 'gap-2.5', className)} title={publicTitle}>
      <Terminal className={cn(iconSize, 'shrink-0 text-brand')} />
      <span className={cn('min-w-0 truncate', textSize, shimmer ? 'animate-shimmer' : 'text-brand')}>
        <span className="font-medium">windows native </span>
        <span className="font-bold">{APP_PUBLIC_DISPLAY_NAME}</span>
      </span>
    </div>
  );
};

export default AppLogo;
