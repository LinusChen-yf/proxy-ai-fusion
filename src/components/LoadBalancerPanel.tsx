import { useState, useEffect } from 'react';
import { api } from '@/services/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Save } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useFeedback } from '@/components/FeedbackProvider';
import { DEFAULT_LOAD_BALANCER_CONFIG, type LoadBalancerConfig } from '@/types/loadbalancer';

export function LoadBalancerPanel() {
  const { t } = useTranslation();
  const feedback = useFeedback();
  const [config, setConfig] = useState<LoadBalancerConfig>(DEFAULT_LOAD_BALANCER_CONFIG);

  const loadConfig = async () => {
    try {
      const data = await api.getLoadBalancerConfig();
      setConfig({
        strategy: 'weighted',
        healthCheck: {
          ...DEFAULT_LOAD_BALANCER_CONFIG.healthCheck,
          ...data.healthCheck,
        },
        freezeDuration: data.freezeDuration ?? DEFAULT_LOAD_BALANCER_CONFIG.freezeDuration,
      });
    } catch (error) {
      console.error('Failed to load load balancer config:', error);
      feedback.showError(t('loadbalancer.error.load'));
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleSave = async () => {
    try {
      await api.updateLoadBalancerConfig({
        ...config,
        strategy: 'weighted',
      });
    } catch (error) {
      console.error('Failed to save load balancer config:', error);
      feedback.showError(t('loadbalancer.error.save'));
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t('lb.title')}</CardTitle>
            <CardDescription>{t('lb.description')}</CardDescription>
          </div>
          <Button onClick={handleSave}>
            <Save className="mr-2 h-4 w-4" />
            {t('common.save')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div className="grid gap-2">
            <Label htmlFor="health_check_interval">{t('lb.healthInterval')}</Label>
            <Input
              id="health_check_interval"
              type="number"
              value={Math.round(config.healthCheck.interval / 1000)}
              onChange={(e) => {
                const seconds = parseInt(e.target.value, 10) || 0;
                setConfig(prev => ({
                  ...prev,
                  healthCheck: {
                    ...prev.healthCheck,
                    interval: seconds * 1000,
                  },
                }));
              }}
              min="1"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="failure_threshold">{t('lb.failureThreshold')}</Label>
            <Input
              id="failure_threshold"
              type="number"
              value={config.healthCheck.failureThreshold}
              onChange={(e) => {
                const threshold = parseInt(e.target.value, 10) || 0;
                setConfig(prev => ({
                  ...prev,
                  healthCheck: {
                    ...prev.healthCheck,
                    failureThreshold: threshold,
                  },
                }));
              }}
              min="1"
            />
            <p className="text-xs text-muted-foreground">
              {t('lb.failureHint')}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="success_threshold">{t('lb.successThreshold')}</Label>
            <Input
              id="success_threshold"
              type="number"
              value={config.healthCheck.successThreshold}
              onChange={(e) => {
                const threshold = parseInt(e.target.value, 10) || 0;
                setConfig(prev => ({
                  ...prev,
                  healthCheck: {
                    ...prev.healthCheck,
                    successThreshold: threshold,
                  },
                }));
              }}
              min="1"
            />
            <p className="text-xs text-muted-foreground">
              {t('lb.successHint')}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="freeze_duration">{t('lb.freezeDuration')}</Label>
            <Input
              id="freeze_duration"
              type="number"
              value={Math.round(config.freezeDuration / 1000)}
              onChange={(e) => {
                const seconds = parseInt(e.target.value, 10) || 0;
                setConfig(prev => ({
                  ...prev,
                  freezeDuration: seconds * 1000,
                }));
              }}
              min="60"
            />
            <p className="text-xs text-muted-foreground">
              {t('lb.freezeHint')}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
