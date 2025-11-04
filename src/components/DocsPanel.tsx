import { useEffect, useMemo, useRef, useState } from 'react';
import type { ServiceId } from '@/types/common';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { useFeedback } from '@/components/FeedbackProvider';
import { api } from '@/services/api';
import { Clipboard, ClipboardCheck, Loader2 } from 'lucide-react';

const CLAUDE_CODE_SETTINGS_TEMPLATE = {
  env: {
    ANTHROPIC_AUTH_TOKEN: '-',
    ANTHROPIC_BASE_URL: 'http://localhost:8801',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000',
    MAX_THINKING_TOKENS: '30000',
    DISABLE_AUTOUPDATER: '1',
  },
  permissions: {
    allow: [] as string[],
    deny: [] as string[],
  },
  alwaysThinkingEnabled: true,
} as const;

export function DocsPanel() {
  const { t } = useTranslation();
  const feedback = useFeedback();
  const [activeService, setActiveService] = useState<ServiceId>('claude');
  const [claudeSetupLoading, setClaudeSetupLoading] = useState(false);
  const [claudeSetupMessage, setClaudeSetupMessage] = useState<string | null>(null);
  const [claudeCopyState, setClaudeCopyState] = useState<'idle' | 'copied'>('idle');
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const claudeSettingsText = useMemo(
    () => JSON.stringify(CLAUDE_CODE_SETTINGS_TEMPLATE, null, 2),
    [],
  );

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleSetupLocalClaude = async () => {
    if (claudeSetupLoading) {
      return;
    }

    setClaudeSetupLoading(true);
    setClaudeSetupMessage(null);

    try {
      const response = await api.setupLocalClaudeCode();
      const messageKey = response.backupCreated
        ? 'docs.claude.local.successWithBackup'
        : 'docs.claude.local.success';
      const message = t(messageKey, {
        path: response.settingsPath ?? '~/.claude/settings.json',
        backup: response.backupPath ?? '~/.claude/settings.json.backup',
      });
      setClaudeSetupMessage(message);
      feedback.showSuccess(message);
    } catch (error) {
      const description =
        error instanceof Error ? error.message : t('docs.common.unknownError');
      const message = t('docs.claude.local.error', { message: description });
      setClaudeSetupMessage(message);
      feedback.showError(message);
    } finally {
      setClaudeSetupLoading(false);
    }
  };

  const handleCopyTemplate = async () => {
    if (typeof navigator === 'undefined' || !navigator?.clipboard) {
      feedback.showInfo(t('docs.common.copyUnavailable'));
      return;
    }

    try {
      await navigator.clipboard.writeText(claudeSettingsText);
      setClaudeCopyState('copied');
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => {
        setClaudeCopyState('idle');
        copyTimeoutRef.current = undefined;
      }, 2000);
    } catch {
      feedback.showError(t('docs.common.copyFailed'));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('docs.title')}</CardTitle>
        <CardDescription>{t('docs.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs value={activeService} onValueChange={value => setActiveService(value as ServiceId)}>
          <TabsList className="grid grid-cols-2 gap-2">
            <TabsTrigger value="claude" className="capitalize">
              {t('service.claude.name')}
            </TabsTrigger>
            <TabsTrigger value="codex" className="capitalize">
              {t('service.codex.name')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="claude" className="space-y-6 pt-6">
            <section className="space-y-3 rounded-lg border border-dashed p-4">
              <h3 className="text-lg font-semibold">{t('docs.claude.local.title')}</h3>
              <p className="text-sm text-muted-foreground">
                {t('docs.claude.local.description')}
              </p>
              <Button onClick={handleSetupLocalClaude} disabled={claudeSetupLoading}>
                {claudeSetupLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {t('docs.claude.local.button')}
              </Button>
              {claudeSetupMessage ? (
                <p className="text-sm text-muted-foreground">{claudeSetupMessage}</p>
              ) : null}
            </section>

            <section className="space-y-4 rounded-lg border p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold">{t('docs.claude.remote.title')}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t('docs.claude.remote.description')}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={handleCopyTemplate}>
                  {claudeCopyState === 'copied' ? (
                    <ClipboardCheck className="mr-2 h-4 w-4" />
                  ) : (
                    <Clipboard className="mr-2 h-4 w-4" />
                  )}
                  {claudeCopyState === 'copied'
                    ? t('docs.common.copied')
                    : t('docs.common.copy')}
                </Button>
              </div>
              <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-4 text-xs leading-relaxed">{claudeSettingsText}</pre>
              <p className="text-xs text-muted-foreground">
                {t('docs.claude.remote.note')}
              </p>
            </section>
          </TabsContent>

          <TabsContent value="codex" className="space-y-6 pt-6">
            <section className="space-y-3 rounded-lg border border-dashed p-4">
              <h3 className="text-lg font-semibold">{t('docs.codex.title')}</h3>
              <p className="text-sm text-muted-foreground">
                {t('docs.codex.description')}
              </p>
              <ul className="list-disc space-y-2 pl-6 text-sm text-muted-foreground">
                <li>{t('docs.codex.stepProxy')}</li>
                <li>{t('docs.codex.stepKey')}</li>
                <li>{t('docs.codex.stepTest')}</li>
              </ul>
            </section>

            <section className="space-y-3 rounded-lg border p-4">
              <h3 className="text-lg font-semibold">{t('docs.codex.notesTitle')}</h3>
              <p className="text-sm text-muted-foreground">
                {t('docs.codex.notesDescription')}
              </p>
            </section>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
