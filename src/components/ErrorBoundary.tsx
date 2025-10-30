import React, { Component, ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';
import { i18n, type Language } from '@/services/i18n';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  language: Language;
}

export class ErrorBoundary extends Component<Props, State> {
  private unsubscribe?: () => void;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, language: i18n.getCurrentLanguage() };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, language: i18n.getCurrentLanguage() };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  componentDidMount() {
    this.unsubscribe = i18n.subscribe((language) => {
      this.setState({ language });
    });
  }

  componentWillUnmount() {
    this.unsubscribe?.();
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const title = i18n.t('common.somethingWrong');
      const description = i18n.t('common.errorOccurred');
      const reloadLabel = i18n.t('common.reloadPage');
      const tryAgainLabel = i18n.t('common.tryAgain');
      const showStackLabel = i18n.t('common.showStack');

      return (
        <Card className="m-4">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-6 w-6 text-destructive" />
              <CardTitle>{title}</CardTitle>
            </div>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {this.state.error && (
              <div className="bg-muted p-4 rounded-lg">
                <p className="font-mono text-sm text-destructive">{this.state.error.message}</p>
                {this.state.error.stack && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      {showStackLabel}
                    </summary>
                    <pre className="mt-2 text-xs overflow-auto">{this.state.error.stack}</pre>
                  </details>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={this.handleReset}>{reloadLabel}</Button>
              <Button variant="outline" onClick={() => this.setState({ hasError: false })}>
                {tryAgainLabel}
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}
