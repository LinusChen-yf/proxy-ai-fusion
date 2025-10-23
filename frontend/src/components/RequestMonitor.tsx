import { useState, useEffect } from 'react';
import { WebSocketManager } from '@/services/websocket';
import type { WebSocketEvent } from '@/types/events';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Activity } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface RequestState {
  id: string;
  method: string;
  path: string;
  timestamp: string;
  status?: number;
  duration?: number;
  error?: string;
}

export function RequestMonitor() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState<Map<string, RequestState>>(new Map());
  const [wsManager] = useState(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return new WebSocketManager(`${protocol}//${host}/ws/realtime`);
  });

  useEffect(() => {
    const handleEvent = (event: WebSocketEvent) => {
      setRequests((prev) => {
        const next = new Map(prev);
        
        switch (event.type) {
          case 'request_started':
            next.set(event.id, {
              id: event.id,
              method: event.method,
              path: event.path,
              timestamp: event.timestamp,
            });
            break;
            
          case 'request_completed':
            const existing = next.get(event.id);
            if (existing) {
              next.set(event.id, {
                ...existing,
                status: event.status,
                duration: event.duration_ms,
                error: event.error,
              });
            }
            break;
            
          case 'chunk_received':
            break;
        }
        
        return next;
      });
    };

    const removeHandler = wsManager.addHandler(handleEvent);
    wsManager.connect();

    return () => {
      removeHandler();
      wsManager.disconnect();
    };
  }, [wsManager]);

  const getStatusBadge = (request: RequestState) => {
    if (!request.status) {
      return <Badge variant="secondary">{t('common.inProgress')}</Badge>;
    }
    
    if (request.status >= 200 && request.status < 300) {
      return <Badge variant="default">{request.status}</Badge>;
    } else if (request.status >= 400) {
      return <Badge variant="destructive">{request.status}</Badge>;
    } else {
      return <Badge variant="secondary">{request.status}</Badge>;
    }
  };

  const requestsList = Array.from(requests.values()).slice(-20).reverse();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              {t('monitor.title')}
            </CardTitle>
            <CardDescription>{t('monitor.description')}</CardDescription>
          </div>
          <Badge variant="outline">{t('monitor.trackedCount', { count: requests.size })}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('common.time')}</TableHead>
              <TableHead>{t('common.method')}</TableHead>
              <TableHead>{t('common.path')}</TableHead>
              <TableHead>{t('common.status')}</TableHead>
              <TableHead>{t('common.duration')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requestsList.map((request) => (
              <TableRow key={request.id}>
                <TableCell>{new Date(request.timestamp).toLocaleTimeString()}</TableCell>
                <TableCell className="font-mono text-sm">{request.method}</TableCell>
                <TableCell className="font-mono text-sm">{request.path}</TableCell>
                <TableCell>{getStatusBadge(request)}</TableCell>
                <TableCell>
                  {request.duration !== undefined ? `${request.duration}ms` : '-'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {requestsList.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">
            {t('monitor.empty')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
