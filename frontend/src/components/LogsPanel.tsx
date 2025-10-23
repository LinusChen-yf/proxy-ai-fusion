import { useState, useEffect } from 'react';
import { api } from '@/services/api';
import type { RequestLog } from '@/types/logs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RefreshCw, Eye } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

export function LogsPanel() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState<RequestLog | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const data = await api.getLogs(50, 0);
      setLogs(data);
    } catch (error) {
      console.error('Failed to load logs:', error);
      alert(t('logs.error.load'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const handleViewDetails = async (id: string) => {
    try {
      const log = await api.getLogById(id);
      setSelectedLog(log);
      setDialogOpen(true);
    } catch (error) {
      console.error('Failed to load log details:', error);
      alert(t('logs.error.details'));
    }
  };

  const getStatusBadge = (statusCode: number) => {
    if (statusCode >= 200 && statusCode < 300) {
      return <Badge variant="default">{ statusCode}</Badge>;
    } else if (statusCode >= 400) {
      return <Badge variant="destructive">{statusCode}</Badge>;
    } else {
      return <Badge variant="secondary">{statusCode}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t('logs.title')}</CardTitle>
            <CardDescription>{t('logs.description')}</CardDescription>
          </div>
          <Button variant="outline" onClick={loadLogs} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('logs.refresh')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('logs.table.timestamp')}</TableHead>
              <TableHead>{t('common.service')}</TableHead>
              <TableHead>{t('common.method')}</TableHead>
              <TableHead>{t('common.targetUrl')}</TableHead>
              <TableHead>{t('common.status')}</TableHead>
              <TableHead>{t('common.duration')}</TableHead>
              <TableHead className="text-right">{t('common.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell>{new Date(log.timestamp).toLocaleString()}</TableCell>
                <TableCell>{log.service}</TableCell>
                <TableCell className="font-mono text-sm">{log.method}</TableCell>
                <TableCell className="font-mono text-sm">
                  {log.target_url ?? log.path}
                </TableCell>
                <TableCell>{getStatusBadge(log.status_code)}</TableCell>
                <TableCell>{log.duration_ms}ms</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => handleViewDetails(log.id)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('logs.detailsTitle')}</DialogTitle>
              <DialogDescription>
                {selectedLog && (selectedLog.target_url ?? `${selectedLog.method} ${selectedLog.path}`)}
              </DialogDescription>
            </DialogHeader>
            {selectedLog && (
              <Tabs defaultValue="basic" className="w-full">
                <TabsList>
                  <TabsTrigger value="basic">{t('logs.tabs.basic')}</TabsTrigger>
                  <TabsTrigger value="request">{t('logs.tabs.request')}</TabsTrigger>
                  <TabsTrigger value="response">{t('logs.tabs.response')}</TabsTrigger>
                  {selectedLog.usage && <TabsTrigger value="usage">{t('logs.tabs.usage')}</TabsTrigger>}
                </TabsList>

                <TabsContent value="basic" className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium">{t('common.id')}</p>
                      <p className="text-sm text-muted-foreground font-mono">{selectedLog.id}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium">{t('logs.table.timestamp')}</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(selectedLog.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium">{t('common.service')}</p>
                      <p className="text-sm text-muted-foreground">{selectedLog.service}</p>
                    </div>
                    {selectedLog.channel && (
                      <div>
                        <p className="text-sm font-medium">{t('common.channel')}</p>
                        <p className="text-sm text-muted-foreground">{selectedLog.channel}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium">{t('common.statusCode')}</p>
                      <p className="text-sm text-muted-foreground">{selectedLog.status_code}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium">{t('common.duration')}</p>
                      <p className="text-sm text-muted-foreground">{selectedLog.duration_ms}ms</p>
                    </div>
                    {selectedLog.target_url && (
                      <div className="col-span-2">
                        <p className="text-sm font-medium">{t('common.targetUrl')}</p>
                        <p className="text-sm text-muted-foreground break-all">{selectedLog.target_url}</p>
                      </div>
                    )}
                  </div>
                  {selectedLog.error_message && (
                    <div>
                      <p className="text-sm font-medium text-destructive">{t('common.error')}</p>
                      <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                        {selectedLog.error_message}
                      </pre>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="request" className="space-y-4">
                  <div>
                    <p className="text-sm font-medium">{t('common.headers')}</p>
                    <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                      {JSON.stringify(selectedLog.request_headers ?? {}, null, 2)}
                    </pre>
                  </div>
                  {selectedLog.request_body && (
                    <div>
                      <p className="text-sm font-medium">{t('common.body')}</p>
                      <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                        {selectedLog.request_body}
                      </pre>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="response" className="space-y-4">
                  <div>
                    <p className="text-sm font-medium">{t('common.headers')}</p>
                    <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                      {JSON.stringify(selectedLog.response_headers ?? {}, null, 2)}
                    </pre>
                  </div>
                  {selectedLog.response_body && (
                    <div>
                      <p className="text-sm font-medium">{t('common.body')}</p>
                      <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                        {selectedLog.response_body}
                      </pre>
                    </div>
                  )}
                </TabsContent>

                {selectedLog.usage && (
                  <TabsContent value="usage" className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm font-medium">{t('common.model')}</p>
                        <p className="text-sm text-muted-foreground">{selectedLog.usage.model}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium">{t('common.totalTokens')}</p>
                        <p className="text-sm text-muted-foreground">{selectedLog.usage.total_tokens}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium">{t('common.promptTokens')}</p>
                        <p className="text-sm text-muted-foreground">{selectedLog.usage.prompt_tokens}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium">{t('common.completionTokens')}</p>
                        <p className="text-sm text-muted-foreground">{selectedLog.usage.completion_tokens}</p>
                      </div>
                    </div>
                  </TabsContent>
                )}
              </Tabs>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
