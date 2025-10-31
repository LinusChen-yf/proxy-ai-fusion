import { useState, useEffect } from 'react';
import { api } from '@/services/api';
import type { ServiceConfig, ClaudeConfig, CodexConfig, ServiceId, TestConnectionResponse } from '@/types/common';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Edit, Trash2, Key, Shield, ShieldCheck, Eye, EyeOff, CircleOff, Power } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useFeedback } from '@/components/FeedbackProvider';

const SERVICE_ORDER: ServiceId[] = ['claude', 'codex'];

const SERVICE_METADATA: Record<
  ServiceId,
  {
    labelKey: string;
    descriptionKey: string;
    exampleNameKey: string;
    exampleUrlKey: string;
  }
> = {
  claude: {
    labelKey: 'service.claude.name',
    descriptionKey: 'service.claude.description',
    exampleNameKey: 'service.claude.exampleName',
    exampleUrlKey: 'service.claude.exampleUrl',
  },
  codex: {
    labelKey: 'service.codex.name',
    descriptionKey: 'service.codex.description',
    exampleNameKey: 'service.codex.exampleName',
    exampleUrlKey: 'service.codex.exampleUrl',
  },
};

function normalizeFreezeUntil(config: ServiceConfig | Record<string, unknown>): number | undefined {
  const raw = (config as any).freeze_until ?? (config as any).freezeUntil ?? null;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function normalizeServiceConfigs<T extends ServiceConfig>(
  configs: Record<string, T> | T[] | undefined,
): T[] {
  if (!configs) {
    return [];
  }

  const configArray = Array.isArray(configs)
    ? configs
    : Object.entries(configs).map(([name, config]) => ({ ...config, name }));

  // Convert camelCase to snake_case for frontend compatibility
  return configArray.map(config => ({
    ...config,
    base_url: (config as any).baseUrl || (config as any).base_url,
    auth_token: (config as any).authToken || (config as any).auth_token,
    api_key: (config as any).apiKey || (config as any).api_key,
    enabled: (config as any).enabled ?? true,
    freeze_until: normalizeFreezeUntil(config),
  } as T));
}

type ConfigFormState = {
  name: string;
  base_url: string;
  api_key: string;
  auth_token: string;
  weight: number;
};

export function ConfigPanel() {
  const { t } = useTranslation();
  const feedback = useFeedback();
  const [activeService, setActiveService] = useState<ServiceId>('claude');
  const [configs, setConfigs] = useState<{ claude: ClaudeConfig[]; codex: CodexConfig[] }>({
    claude: [],
    codex: [],
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ServiceConfig | null>(null);
  const [editingService, setEditingService] = useState<ServiceId>('claude');
  const [authType, setAuthType] = useState<'api_key' | 'auth_token'>('auth_token');
  const [formData, setFormData] = useState<ConfigFormState>({
    name: '',
    base_url: '',
    api_key: '',
    auth_token: '',
    weight: 1,
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [showAuthToken, setShowAuthToken] = useState(false);
  const [testLoading, setTestLoading] = useState<Record<ServiceId, boolean>>({
    claude: false,
    codex: false,
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [configToDelete, setConfigToDelete] = useState<{ service: ServiceId; name: string } | null>(null);
  const STORAGE_KEY = 'config_test_results';
  const [testResults, setTestResults] = useState<
    Record<ServiceId, Record<string, TestConnectionResponse & { completedAt: string }>>
  >(() => {
    const empty: Record<ServiceId, Record<string, TestConnectionResponse & { completedAt: string }>> = {
      claude: {},
      codex: {},
    };
    if (typeof window === 'undefined') {
      return empty;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return empty;
      }
      const parsed = JSON.parse(raw) as Record<
        ServiceId,
        Record<string, TestConnectionResponse & { completedAt: string }>
      >;
      return {
        claude: parsed?.claude ?? {},
        codex: parsed?.codex ?? {},
      };
    } catch (error) {
      console.warn('Failed to parse stored test results', error);
      return empty;
    }
  });

  const loadConfigs = async () => {
    try {
      const [claudeData, codexData] = await Promise.all([
        api.listClaudeConfigs(),
        api.listCodexConfigs(),
  ]);

      setConfigs({
        claude: normalizeServiceConfigs<ClaudeConfig>(claudeData.configs),
        codex: normalizeServiceConfigs<CodexConfig>(codexData.configs),
      });

    } catch (error) {
      console.error('Failed to load configs:', error);
      setConfigs({ claude: [], codex: [] });
    }
  };

  useEffect(() => {
    loadConfigs();
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(testResults));
    }
  }, [testResults]);

  const handleCreate = (service: ServiceId) => {
    setEditingConfig(null);
    setEditingService(service);
    setAuthType('auth_token');
    setFormData({ name: '', base_url: '', api_key: '', auth_token: '', weight: 1 });
    setDialogOpen(true);
  };

  const handleEdit = (service: ServiceId, config: ServiceConfig) => {
    setEditingConfig(config);
    setEditingService(service);
    setAuthType(config.api_key ? 'api_key' : 'auth_token');
    setFormData({
      name: config.name,
      base_url: config.base_url,
      api_key: config.api_key || '',
      auth_token: config.auth_token || '',
      weight: config.weight,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      feedback.showInfo(t('config.validation.name'));
      return;
    }
    if (!formData.base_url.trim()) {
      feedback.showInfo(t('config.validation.baseUrl'));
      return;
    }

    const authValue = authType === 'api_key' ? formData.api_key : formData.auth_token;
    if (!authValue.trim()) {
      feedback.showInfo(
        authType === 'api_key' ? t('config.validation.apiKey') : t('config.validation.authToken'),
      );
      return;
    }

    try {
      const configData = {
        name: formData.name,
        base_url: formData.base_url,
        weight: formData.weight,
        ...(authType === 'api_key'
          ? { api_key: formData.api_key, auth_token: undefined }
          : { auth_token: formData.auth_token, api_key: undefined }),
      };

      if (editingConfig) {
        if (editingService === 'claude') {
          await api.updateClaudeConfig(editingConfig.name, configData);
        } else {
          await api.updateCodexConfig(editingConfig.name, configData);
        }
      } else if (editingService === 'claude') {
        await api.createClaudeConfig(configData);
      } else {
        await api.createCodexConfig(configData);
      }

      await loadConfigs();
      setDialogOpen(false);
    } catch (error) {
      console.error('Failed to save config:', error);
      feedback.showError(t('config.error.save', { message: String(error) }));
    }
  };

  const handleDelete = (service: ServiceId, name: string) => {
    setConfigToDelete({ service, name });
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!configToDelete) return;

    const { service, name } = configToDelete;

    try {
      if (service === 'claude') {
        await api.deleteClaudeConfig(name);
      } else {
        await api.deleteCodexConfig(name);
      }
      await loadConfigs();
    } catch (error) {
      console.error('Failed to delete config:', error);
      feedback.showError(t('config.error.delete'));
    } finally {
      setDeleteDialogOpen(false);
      setConfigToDelete(null);
    }
  };

  const handleToggleConfigEnabled = async (
    service: ServiceId,
    config: ServiceConfig,
    enabled: boolean,
  ) => {
    try {
      if (service === 'claude') {
        await api.updateClaudeConfig(config.name, { enabled });
      } else {
        await api.updateCodexConfig(config.name, { enabled });
      }

      await loadConfigs();
    } catch (error) {
      console.error('Failed to toggle config state:', error);
      feedback.showError(t('config.error.toggle'));
    }
  };

  const handleTest = async (service: ServiceId) => {
    // Get all enabled configs for this service
    const enabledConfigs = configs[service].filter(config => config.enabled !== false);

    if (enabledConfigs.length === 0) {
      return;
    }

    setTestLoading((prev) => ({ ...prev, [service]: true }));
    try {
      // Test all enabled configs in parallel
      const testPromises = enabledConfigs.map(async (config) => {
        try {
          let result: TestConnectionResponse;
          if (service === 'claude') {
            result = await api.testClaudeApi(config.name);
          } else {
            result = await api.testCodexApi(config.name);
          }
          return { configName: config.name, result, error: null };
        } catch (error) {
          return {
            configName: config.name,
            result: {
              success: false,
              message: String(error),
            },
            error,
          };
        }
      });

      const timestamp = new Date().toISOString();
      const results = await Promise.all(testPromises);

      // Update all test results
      setTestResults((prev) => ({
        ...prev,
        [service]: {
          ...(prev[service] ?? {}),
          ...results.reduce((acc, { configName, result }) => {
            acc[configName] = {
              ...result,
              completedAt: timestamp,
            };
            return acc;
                  }, {} as Record<string, TestConnectionResponse & { completedAt: string }>),
        },
      }));

      await loadConfigs();
    } finally {
      setTestLoading((prev) => ({ ...prev, [service]: false }));
    }
  };

  const renderServiceConfigs = (service: ServiceId) => {
    const currentConfigs = configs[service];
    const serviceMeta = SERVICE_METADATA[service];
    const serviceLabel = t(serviceMeta.labelKey);
    const exampleName = t(serviceMeta.exampleNameKey);
    const exampleUrl = t(serviceMeta.exampleUrlKey);
    if (currentConfigs.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="rounded-full bg-muted p-6 mb-4">
            <Plus className="h-12 w-12 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">
            {t('config.empty.title', { service: serviceLabel })}
          </h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-md">
            {t('config.empty.description', { service: serviceLabel })}
          </p>
          <Button onClick={() => handleCreate(service)} size="lg">
            <Plus className="mr-2 h-5 w-5" />
            {t('config.empty.button', { service: serviceLabel })}
          </Button>
          <div className="mt-8 text-left bg-muted/50 rounded-lg p-4 max-w-md">
            <p className="text-xs font-semibold mb-2">💡 {t('config.empty.exampleTitle')}</p>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>
                • {t('config.empty.exampleNameLabel')}{' '}
                <code className="bg-background px-1 rounded">{exampleName}</code>
              </li>
              <li>
                • {t('config.empty.exampleUrlLabel')}{' '}
                <code className="bg-background px-1 rounded">{exampleUrl}</code>
              </li>
              <li>• {t('config.empty.exampleAuth')}</li>
              <li>
                • {t('config.empty.exampleWeightLabel')}{' '}
                <code className="bg-background px-1 rounded">1.0</code>{' '}
                {t('config.empty.exampleWeightHint')}
              </li>
            </ul>
          </div>
        </div>
      );
    }

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('config.name')}</TableHead>
            <TableHead>{t('config.baseUrl')}</TableHead>
            <TableHead>{t('config.weight')}</TableHead>
            <TableHead>{t('config.status')}</TableHead>
            <TableHead>{t('config.test.result')}</TableHead>
            <TableHead className="text-right">{t('config.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {currentConfigs.map((config) => {
            const isEnabled = config.enabled !== false;
            const result = testResults[service]?.[config.name];
            const isFrozen = config.freeze_until && Date.now() < config.freeze_until;
            const status = !isEnabled
              ? { label: t('config.status.disabled'), className: 'text-muted-foreground' }
              : isFrozen
                ? { label: t('config.status.frozen'), className: 'text-destructive' }
                : {
                    label: t('config.status.ok'),
                    className: result?.success ? 'text-emerald-600' : 'text-muted-foreground',
                  };

            return (
              <TableRow key={config.name}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{config.name}</span>
                    {config.api_key && (
                      <span title={t('common.apiKey')}>
                        <Key className="h-3 w-3 text-muted-foreground" />
                      </span>
                    )}
                    {config.auth_token && (
                      <span title={t('common.authToken')}>
                        <Shield className="h-3 w-3 text-muted-foreground" />
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-sm">{config.base_url}</TableCell>
                <TableCell>{config.weight}</TableCell>
                <TableCell>
                  <span className={`text-xs font-medium ${status.className}`}>{status.label}</span>
                </TableCell>
                <TableCell className="align-top">
                  {(() => {
                    if (!result) {
                      return <span className="text-xs text-muted-foreground">{t('config.test.notRun')}</span>;
                    }

                    const testedTime = new Date(result.completedAt).toLocaleTimeString();
                    return (
                      <div className="flex flex-col gap-1 text-xs">
                        <span className={result.success ? 'text-emerald-600' : 'text-destructive'}>
                          {result.success ? t('config.test.successShort') : t('config.test.failedShort')}
                        </span>
                        {result.status_code !== undefined && (
                          <span className="text-muted-foreground">
                            {t('config.test.statusCode', { code: result.status_code })}
                          </span>
                        )}
                        {result.duration_ms !== undefined && (
                          <span className="text-muted-foreground">
                            {t('config.test.duration', { ms: result.duration_ms })}
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          {t('config.test.testedAt', { time: testedTime })}
                        </span>
                        {result.response_preview && (
                          <span className="text-muted-foreground break-words">
                            {result.response_preview}
                          </span>
                        )}
                        {result.message && (
                          <span className="text-muted-foreground break-words">{result.message}</span>
                        )}
                      </div>
                    );
                  })()}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggleConfigEnabled(service, config, !isEnabled)}
                      title={isEnabled ? t('config.disableSingle') : t('config.enableSingle')}
                    >
                      {isEnabled ? <CircleOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(service, config)}
                      title={t('common.edit')}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(service, config.name)}
                      title={t('common.delete')}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  };

  const enabledConfigs = configs[activeService].filter(config => config.enabled !== false);
  const hasEnabledConfigs = enabledConfigs.length > 0;

  const editingMeta = SERVICE_METADATA[editingService];
  const editingServiceLabel = t(editingMeta.labelKey);
  const editingExampleUrl = t(editingMeta.exampleUrlKey);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>{t('config.title')}</CardTitle>
            <CardDescription>{t('config.description')}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => handleTest(activeService)}
              disabled={
                !hasEnabledConfigs ||
                testLoading[activeService]
              }
            >
              <ShieldCheck className="mr-2 h-4 w-4" />
              {testLoading[activeService] ? t('config.test.running') : t('config.test.api')}
            </Button>
            <Button onClick={() => handleCreate(activeService)}>
              <Plus className="mr-2 h-4 w-4" />
              {t('config.addFor', { service: t(SERVICE_METADATA[activeService].labelKey) })}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeService} onValueChange={(value) => setActiveService(value as ServiceId)}>
          <TabsList className="grid grid-cols-2">
            {SERVICE_ORDER.map((service) => (
              <TabsTrigger key={service} value={service} className="capitalize">
                {t(SERVICE_METADATA[service].labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
          {SERVICE_ORDER.map((service) => (
            <TabsContent key={service} value={service} className="mt-6">
              {renderServiceConfigs(service)}
            </TabsContent>
          ))}
        </Tabs>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingConfig
                  ? t('config.dialog.edit', { service: editingServiceLabel })
                  : t('config.dialog.create', { service: editingServiceLabel })}
              </DialogTitle>
              <DialogDescription>
                {t('config.dialog.description', { service: editingServiceLabel })}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">
                  {t('config.form.nameLabel')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  disabled={!!editingConfig}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  {t('config.form.nameHint', { service: editingServiceLabel })}
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="base_url">
                  {t('config.form.baseUrlLabel')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="base_url"
                  value={formData.base_url}
                  onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
                  placeholder={editingExampleUrl}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  {t('config.form.baseUrlHint', { url: editingExampleUrl })}
                </p>
              </div>
              <div className="grid gap-3 p-4 border rounded-lg bg-muted/50">
                <Label>
                  {t('config.form.authMethod')} <span className="text-destructive">*</span>
                </Label>
                <div className="flex gap-4">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      name="authType"
                      value="auth_token"
                      checked={authType === 'auth_token'}
                      onChange={(e) => setAuthType(e.target.value as 'auth_token')}
                      className="w-4 h-4"
                    />
                    <span className="text-sm font-medium">{t('config.form.authToken')}</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      name="authType"
                      value="api_key"
                      checked={authType === 'api_key'}
                      onChange={(e) => setAuthType(e.target.value as 'api_key')}
                      className="w-4 h-4"
                    />
                    <span className="text-sm font-medium">{t('config.form.apiKey')}</span>
                  </label>
                </div>
                {authType === 'api_key' ? (
                  <div className="grid gap-2 mt-2">
                    <Label htmlFor="api_key">
                      {t('config.form.apiKey')} <span className="text-destructive">*</span>
                    </Label>
                    <div className="relative">
                      <Input
                        id="api_key"
                        type={showApiKey ? "text" : "password"}
                        value={formData.api_key}
                        onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                        required
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowApiKey(!showApiKey)}
                      >
                        {showApiKey ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('config.form.apiKeyHint')}
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-2 mt-2">
                    <Label htmlFor="auth_token">
                      {t('config.form.authToken')} <span className="text-destructive">*</span>
                    </Label>
                    <div className="relative">
                      <Input
                        id="auth_token"
                        type={showAuthToken ? "text" : "password"}
                        value={formData.auth_token}
                        onChange={(e) => setFormData({ ...formData, auth_token: e.target.value })}
                        required
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowAuthToken(!showAuthToken)}
                      >
                        {showAuthToken ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('config.form.authTokenHint')}
                    </p>
                  </div>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="weight">{t('config.form.weightLabel')}</Label>
                <Input
                  id="weight"
                  type="number"
                  value={formData.weight}
                  onChange={(e) => {
                    const parsed = parseFloat(e.target.value);
                    setFormData({ ...formData, weight: Number.isNaN(parsed) ? 1 : parsed });
                  }}
                  min="0"
                  step="0.1"
                />
                <p className="text-xs text-muted-foreground">
                  {t('config.form.weightHint')}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSave}>{t('common.save')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('config.confirmDelete', { name: configToDelete?.name || '' })}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('config.confirmDeleteDescription', { name: configToDelete?.name || '' })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDelete} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {t('common.delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
