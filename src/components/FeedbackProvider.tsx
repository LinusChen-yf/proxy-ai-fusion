import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

type FeedbackVariant = 'info' | 'success' | 'error';

interface FeedbackOptions {
  title?: string;
  description: string;
  variant?: FeedbackVariant;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
}

interface FeedbackState {
  open: boolean;
  title?: string;
  description: string;
  variant: FeedbackVariant;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
}

interface FeedbackContextValue {
  show: (options: FeedbackOptions) => void;
  showError: (description: string, options?: Omit<FeedbackOptions, 'description' | 'variant'>) => void;
  showSuccess: (description: string, options?: Omit<FeedbackOptions, 'description' | 'variant'>) => void;
  showInfo: (description: string, options?: Omit<FeedbackOptions, 'description' | 'variant'>) => void;
  close: () => void;
}

const defaultState: FeedbackState = {
  open: false,
  variant: 'info',
  description: '',
};

const FeedbackContext = createContext<FeedbackContextValue | undefined>(undefined);

const iconByVariant: Record<FeedbackVariant, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  error: AlertTriangle,
};

const iconClassByVariant: Record<FeedbackVariant, string> = {
  info: 'bg-muted text-muted-foreground border border-border/50',
  success: 'bg-primary/10 text-primary border border-primary/30',
  error: 'bg-destructive/10 text-destructive border border-destructive/30',
};

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [state, setState] = useState<FeedbackState>(defaultState);

  const close = useCallback(() => {
    setState(defaultState);
  }, []);

  const show = useCallback((options: FeedbackOptions) => {
    setState({
      open: true,
      variant: options.variant ?? 'info',
      title: options.title,
      description: options.description,
      primaryActionLabel: options.primaryActionLabel,
      onPrimaryAction: options.onPrimaryAction,
    });
  }, []);

  const withVariant = useCallback(
    (variant: FeedbackVariant, description: string, options?: Omit<FeedbackOptions, 'description' | 'variant'>) => {
      show({
        ...options,
        description,
        variant,
      });
    },
    [show],
  );

  const showError = useCallback(
    (description: string, options?: Omit<FeedbackOptions, 'description' | 'variant'>) => {
      withVariant('error', description, options);
    },
    [withVariant],
  );

  const showSuccess = useCallback(
    (description: string, options?: Omit<FeedbackOptions, 'description' | 'variant'>) => {
      withVariant('success', description, options);
    },
    [withVariant],
  );

  const showInfo = useCallback(
    (description: string, options?: Omit<FeedbackOptions, 'description' | 'variant'>) => {
      withVariant('info', description, options);
    },
    [withVariant],
  );

  const value = useMemo<FeedbackContextValue>(
    () => ({
      show,
      showError,
      showSuccess,
      showInfo,
      close,
    }),
    [show, showError, showSuccess, showInfo, close],
  );

  const Icon = iconByVariant[state.variant];
  const iconClass = iconClassByVariant[state.variant];
  const effectiveTitle =
    state.title ??
    (state.variant === 'error' ? t('common.error') : state.variant === 'success' ? t('common.success') : t('common.info'));
  const primaryLabel = state.primaryActionLabel ?? t('common.close');

  const handlePrimaryAction = () => {
    state.onPrimaryAction?.();
    close();
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      close();
    }
  };

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <Dialog open={state.open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader className="space-y-4 text-left">
            <div className={cn('flex h-12 w-12 items-center justify-center rounded-full', iconClass)}>
              <Icon className="h-6 w-6" />
            </div>
            <DialogTitle>{effectiveTitle}</DialogTitle>
            {state.description ? (
              <DialogDescription className="text-left leading-6">{state.description}</DialogDescription>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={handlePrimaryAction}
              variant="default"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {primaryLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error('useFeedback must be used within a FeedbackProvider');
  }
  return context;
}
