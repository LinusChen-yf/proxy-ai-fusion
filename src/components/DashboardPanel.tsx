import { useCallback, useEffect, useState } from 'react';
import { api } from '@/services/api';
import type { ServiceConfig, ServiceId } from '@/types/common';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Link, RefreshCw } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface DashboardService {
  id: ServiceId;
  labelKey: string;
  port: number;
  descriptionKey: string;
}

interface DashboardServiceState {
  configs: ServiceConfig[];
  activeName: string | null;
  mode: 'manual' | 'load_balance';
}

interface DashboardData {
  services: Record<ServiceId, DashboardServiceState>;
}

const SERVICES: DashboardService[] = [
  {
    id: 'claude',
    labelKey: 'service.claude.name',
    port: 8801,
    descriptionKey: 'service.claude.description',
  },
  {
    id: 'codex',
    labelKey: 'service.codex.name',
    port: 8802,
    descriptionKey: 'service.codex.description',
  },
];

function normalizeConfigs(
  configs: Record<string, ServiceConfig> | ServiceConfig[] | undefined,
): ServiceConfig[] {
  if (!configs) {
    return [];
  }

  if (Array.isArray(configs)) {
    return configs;
  }

  return Object.entries(configs).map(([name, config]) => ({
    ...config,
    name,
  }));
}

function getAuthLabelKey(config: ServiceConfig | undefined): string {
  if (!config) {
    return 'common.notConfigured';
  }
  if (config.api_key) {
    return 'common.apiKey';
  }
  if (config.auth_token) {
    return 'common.authToken';
  }
  return 'common.notConfigured';
}

function buildProxyUrl(port: number): string {
  if (typeof window === 'undefined') {
    return `http://localhost:${port}`;
  }

  const { protocol, hostname } = window.location;
  const isIpv6 = hostname.includes(':');
  const formattedHost = isIpv6 ? `[${hostname}]` : hostname;

  return `${protocol}//${formattedHost}:${port}`;
}

function resolveServiceStatus(
  serviceData: DashboardServiceState,
  loading: boolean,
  hasError: boolean,
): { labelKey: string; variant: 'default' | 'secondary' | 'destructive' } {
  if (hasError) {
    return { labelKey: 'dashboard.status.error', variant: 'destructive' };
  }
  if (loading) {
    return { labelKey: 'dashboard.status.loading', variant: 'secondary' };
  }
  if (serviceData.activeName) {
    return { labelKey: 'dashboard.status.active', variant: 'default' };
  }
  if (serviceData.configs.length > 0) {
    return { labelKey: 'dashboard.status.inactive', variant: 'secondary' };
  }
  return { labelKey: 'dashboard.status.missing', variant: 'secondary' };
}

export function DashboardPanel() {
  const { t } = useTranslation();
  const [data, setData] = useState<DashboardData>({
    services: {
      claude: { configs: [], activeName: null, mode: 'manual' },
      codex: { configs: [], activeName: null, mode: 'manual' },
    },
  });
  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [modeUpdating, setModeUpdating] = useState<Record<ServiceId, boolean>>({
    claude: false,
    codex: false,
  });
  const [configUpdating, setConfigUpdating] = useState<Record<ServiceId, boolean>>({
    claude: false,
    codex: false,
  });

  const loadDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      setHasError(false);

      const separatedConfigs = await api.listSeparatedConfigs();

      setData({
        services: {
          claude: {
            configs: normalizeConfigs(separatedConfigs.claude?.configs),
            activeName: separatedConfigs.claude?.active ?? null,
            mode: separatedConfigs.claude?.mode ?? 'manual',
          },
          codex: {
            configs: normalizeConfigs(separatedConfigs.codex?.configs),
            activeName: separatedConfigs.codex?.active ?? null,
            mode: separatedConfigs.codex?.mode ?? 'manual',
          },
        },
      });
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
      setHasError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const handleModeChange = async (service: ServiceId, newMode: 'manual' | 'load_balance') => {
    try {
      setModeUpdating((prev) => ({ ...prev, [service]: true }));
      await api.updateServiceMode(service, newMode);
      
      setData((prev) => ({
        ...prev,
        services: {
          ...prev.services,
          [service]: {
            ...prev.services[service],
            mode: newMode,
          },
        },
      }));
    } catch (error) {
      console.error('Failed to update mode:', error);
      alert(t('config.error.mode'));
    } finally {
      setModeUpdating((prev) => ({ ...prev, [service]: false }));
    }
  };

  const handleConfigSelect = async (service: ServiceId, configName: string) => {
    try {
      setConfigUpdating((prev) => ({ ...prev, [service]: true }));
      if (service === 'claude') {
        await api.activateClaudeConfig(configName);
      } else {
        await api.activateCodexConfig(configName);
      }

      setData((prev) => ({
        ...prev,
        services: {
          ...prev.services,
          [service]: {
            ...prev.services[service],
            activeName: configName,
          },
        },
      }));
    } catch (error) {
      console.error('Failed to activate config:', error);
      alert(t('config.error.activate'));
    } finally {
      setConfigUpdating((prev) => ({ ...prev, [service]: false }));
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>{t('dashboard.title')}</CardTitle>
          <CardDescription>{t('dashboard.subtitle')}</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={loadDashboardData} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('dashboard.refresh')}
        </Button>
      </CardHeader>
      <CardContent>
        {hasError && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {t('dashboard.error')}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {SERVICES.map((service) => {
            const serviceData =
              data.services[service.id] ?? { configs: [], activeName: null, mode: 'manual' };
            const enabledConfigs = serviceData.configs.filter(config => config.enabled !== false);
            const activeConfig = serviceData.activeName
              ? serviceData.configs.find((config) => config.name === serviceData.activeName)
              : undefined;
            const statusInfo = resolveServiceStatus(serviceData, loading, hasError);
            const currentMode = serviceData.mode;
            const selectValue = serviceData.activeName || '';
            const hasConfigs = serviceData.configs.length > 0;
            const hasEnabledConfigs = enabledConfigs.length > 0;

            return (
              <div key={service.id} className="flex flex-col gap-4 rounded-lg border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{t(service.labelKey)}</p>
                    <p className="text-xs text-muted-foreground">{t(service.descriptionKey)}</p>
                  </div>
                  <Badge variant={statusInfo.variant}>{t(statusInfo.labelKey)}</Badge>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t('dashboard.proxyUrl')}</p>
                  <div className="mt-1 flex items-center gap-2 font-mono text-xs md:text-sm">
                    <Link className="h-4 w-4 text-muted-foreground" />
                    <a
                      href={buildProxyUrl(service.port)}
                      className="transition hover:text-primary"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {buildProxyUrl(service.port)}
                    </a>
                  </div>
                  <Tabs 
                    value={currentMode} 
                    onValueChange={(value) => handleModeChange(service.id, value as 'manual' | 'load_balance')}
                    className="mt-3"
                  >
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="manual" disabled={modeUpdating[service.id]}>
                        {t('dashboard.mode.manual')}
                      </TabsTrigger>
                      <TabsTrigger value="load_balance" disabled={modeUpdating[service.id]}>
                        {t('dashboard.mode.loadBalance')}
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="manual" className="mt-3">
                      {loading ? (
                        <div className="h-16 animate-pulse rounded-md bg-muted" />
                      ) : !hasConfigs ? (
                        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                          {t('dashboard.noConfigs', { service: t(service.labelKey) })}
                        </div>
                      ) : !hasEnabledConfigs ? (
                        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                          {t('dashboard.noEnabledConfigs', { service: t(service.labelKey) })}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <label className="text-xs font-medium text-muted-foreground">
                            {t('dashboard.forwardingConfig')}
                          </label>
                          <Select
                            value={selectValue}
                            onValueChange={(value) => handleConfigSelect(service.id, value)}
                            disabled={configUpdating[service.id]}
                          >
                            <SelectTrigger className="mt-1.5">
                              <SelectValue
                                placeholder={t('dashboard.noActive', { service: t(service.labelKey) })}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {enabledConfigs.map(config => (
                                <SelectItem key={config.name} value={config.name}>
                                  {config.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {activeConfig && (
                            <div className="rounded-lg border bg-muted/40 p-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge>{activeConfig.name}</Badge>
                                <span className="text-xs text-muted-foreground">
                                  {t('dashboard.weightLabel', {
                                    value: activeConfig.weight !== undefined ? activeConfig.weight.toFixed(2) : '1.00',
                                  })}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {t('dashboard.authLabel', {
                                    value: t(getAuthLabelKey(activeConfig)),
                                  })}
                                </span>
                              </div>
                              <div className="mt-3 text-sm">
                                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                  {t('dashboard.upstreamUrl')}
                                </p>
                                <p className="mt-1 font-mono text-sm break-all">{activeConfig.base_url}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </TabsContent>
                    <TabsContent value="load_balance" className="mt-3">
                      {loading ? (
                        <div className="h-16 animate-pulse rounded-md bg-muted" />
                      ) : serviceData.configs.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                          {t('dashboard.noConfigs', { service: t(service.labelKey) })}
                        </div>
                      ) : !hasEnabledConfigs ? (
                        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                          {t('dashboard.noEnabledConfigs', { service: t(service.labelKey) })}
                        </div>
                      ) : activeConfig ? (
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">
                            {t('dashboard.forwardingConfig')}
                          </label>
                          <div className="mt-1.5 rounded-lg border bg-muted/40 p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge>{activeConfig.name}</Badge>
                              <span className="text-xs text-muted-foreground">
                                {t('dashboard.weightLabel', {
                                  value: activeConfig.weight !== undefined ? activeConfig.weight.toFixed(2) : '1.00',
                                })}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {t('dashboard.authLabel', {
                                  value: t(getAuthLabelKey(activeConfig)),
                                })}
                              </span>
                            </div>
                            <div className="mt-3 text-sm">
                              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                {t('dashboard.upstreamUrl')}
                              </p>
                              <p className="mt-1 font-mono text-sm break-all">{activeConfig.base_url}</p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                          {t('dashboard.noActive', { service: t(service.labelKey) })}
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
