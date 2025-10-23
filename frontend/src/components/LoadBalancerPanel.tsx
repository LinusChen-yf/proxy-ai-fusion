import { useState, useEffect } from 'react';
import { api } from '@/services/api';
import type { LoadBalancerConfig } from '@/types/loadbalancer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

export function LoadBalancerPanel() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<LoadBalancerConfig>({
    mode: 'weight_selection',
    health_check_interval_secs: 30,
    failure_threshold: 3,
    success_threshold: 2,
  });

  const loadConfig = async () => {
    try {
      const data = await api.getLoadBalancerConfig();
      setConfig(data);
    } catch (error) {
      console.error('Failed to load load balancer config:', error);
      alert(t('loadbalancer.error.load'));
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleSave = async () => {
    try {
      await api.updateLoadBalancerConfig(config);
    } catch (error) {
      console.error('Failed to save load balancer config:', error);
      alert(t('loadbalancer.error.save'));
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
            <Label>{t('lb.mode')}</Label>
            <Select
              value={config.mode}
              onValueChange={(value) => setConfig({ ...config, mode: value as 'weight_selection' | 'round_robin' })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weight_selection">{t('lb.weightSelection')}</SelectItem>
                <SelectItem value="round_robin">{t('lb.roundRobin')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="health_check_interval">{t('lb.healthInterval')}</Label>
            <Input
              id="health_check_interval"
              type="number"
              value={config.health_check_interval_secs}
              onChange={(e) =>
                setConfig({ ...config, health_check_interval_secs: parseInt(e.target.value) })
              }
              min="1"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="failure_threshold">{t('lb.failureThreshold')}</Label>
            <Input
              id="failure_threshold"
              type="number"
              value={config.failure_threshold}
              onChange={(e) => setConfig({ ...config, failure_threshold: parseInt(e.target.value) })}
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
              value={config.success_threshold}
              onChange={(e) => setConfig({ ...config, success_threshold: parseInt(e.target.value) })}
              min="1"
            />
            <p className="text-xs text-muted-foreground">
              {t('lb.successHint')}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
