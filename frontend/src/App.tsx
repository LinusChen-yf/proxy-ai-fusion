import { useState, useEffect } from 'react';
import { i18n, type Language } from '@/services/i18n';
import { useTranslation } from '@/hooks/useTranslation';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ConfigPanel } from '@/components/ConfigPanel';
import { LoadBalancerPanel } from '@/components/LoadBalancerPanel';
import { LogsPanel } from '@/components/LogsPanel';
import { RequestMonitor } from '@/components/RequestMonitor';
import { DashboardPanel } from '@/components/DashboardPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Moon, Sun, Globe } from 'lucide-react';

function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [isReady, setIsReady] = useState(false);
  const { language, t } = useTranslation();

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    const savedLang = localStorage.getItem('language') as Language | null;

    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.classList.toggle('dark', savedTheme === 'dark');
    }

    const initializeLanguage = async () => {
      const langToLoad = savedLang ?? 'en';
      try {
        await i18n.setLanguage(langToLoad);
        if (!savedLang) {
          localStorage.setItem('language', langToLoad);
        }
      } finally {
        setIsReady(true);
      }
    };

    void initializeLanguage();
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
  };

  const handleLanguageChange = async (lang: Language) => {
    localStorage.setItem('language', lang);
    await i18n.setLanguage(lang);
  };

  if (!isReady) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-primary">{t('app.title')}</h1>
              <p className="text-sm text-muted-foreground">{t('app.subtitle')}</p>
            </div>
            <div className="flex items-center gap-2">
              <Select value={language} onValueChange={handleLanguageChange}>
                <SelectTrigger className="w-[100px]">
                  <Globe className="mr-2 h-4 w-4" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{t('language.en')}</SelectItem>
                  <SelectItem value="zh">{t('language.zh')}</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={toggleTheme}>
                {theme === 'light' ? (
                  <Moon className="h-4 w-4" />
                ) : (
                  <Sun className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="dashboard" className="space-y-4">
          <TabsList>
            <TabsTrigger value="dashboard">{t('nav.dashboard')}</TabsTrigger>
            <TabsTrigger value="monitor">{t('nav.monitor')}</TabsTrigger>
            <TabsTrigger value="configs">{t('nav.configs')}</TabsTrigger>
            <TabsTrigger value="loadbalancer">{t('nav.loadbalancer')}</TabsTrigger>
            <TabsTrigger value="logs">{t('nav.logs')}</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-4">
            <ErrorBoundary>
              <DashboardPanel />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="monitor" className="space-y-4">
            <ErrorBoundary>
              <RequestMonitor />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="configs" className="space-y-4">
            <ErrorBoundary>
              <ConfigPanel />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="loadbalancer" className="space-y-4">
            <ErrorBoundary>
              <LoadBalancerPanel />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="logs" className="space-y-4">
            <ErrorBoundary>
              <LogsPanel />
            </ErrorBoundary>
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t mt-12">
        <div className="container mx-auto px-4 py-4 text-center text-sm text-muted-foreground">
          <p>{t('footer.builtWith')}</p>
          <p>{t('footer.version')}</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
