import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Download,
  Loader2,
  Shield,
  Globe,
  Trash2,
  RotateCcw,
  X,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import api from '@/services/api';

// Define plugin status types
type PluginStatus = 'not_installed' | 'installing' | 'installed' | 'error';

interface Addon {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  status: PluginStatus;
  size?: string;
  version?: string;
}

export function AddonsPage() {
  const [addons, setAddons] = useState<Addon[]>([
    {
      id: 'secure-browser',
      name: 'Secure Vault Browser',
      description: 'A secure browser extension for enhanced privacy and protection when accessing vault contents',
      icon: <Shield className="w-6 h-6" />,
      status: 'not_installed',
      size: '~190MB',
      version: '1.0.0'
    }
  ]);
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});

  // Fetch plugin status on mount
  useEffect(() => {
    fetchPluginStatus();
  }, []);

  const fetchPluginStatus = async () => {
    try {
      const status = await api.pluginCheckStatus();
      setAddons(prev =>
        prev.map(addon =>
          addon.id === 'secure-browser'
            ? { ...addon, status }
            : addon
        )
      );
    } catch (error) {
      console.error('Failed to fetch plugin status:', error);
      toast.error('Failed to fetch plugin status');
    }
  };

  const handleInstall = async (addonId: string) => {
    setLoadingStates(prev => ({ ...prev, [addonId]: true }));

    try {
      // Update status to installing immediately
      setAddons(prev =>
        prev.map(addon =>
          addon.id === addonId
            ? { ...addon, status: 'installing' as PluginStatus }
            : addon
        )
      );

      await api.pluginInstall();

      // Update status to installed
      setAddons(prev =>
        prev.map(addon =>
          addon.id === addonId
            ? { ...addon, status: 'installed' as PluginStatus }
            : addon
        )
      );
      toast.success(`${addons.find(a => a.id === addonId)?.name} installed successfully!`);
    } catch (error) {
      console.error(`Failed to install ${addonId}:`, error);
      toast.error(`Failed to install ${addonId}`);
      setAddons(prev =>
        prev.map(addon =>
          addon.id === addonId
            ? { ...addon, status: 'error' as PluginStatus }
            : addon
        )
      );
    } finally {
      setLoadingStates(prev => ({ ...prev, [addonId]: false }));
    }
  };

  const handleUninstall = async (addonId: string) => {
    if (!confirm('Are you sure you want to uninstall this add-on? This action cannot be undone.')) {
      return;
    }

    setLoadingStates(prev => ({ ...prev, [addonId]: true }));

    try {
      await api.pluginUninstall();

      setAddons(prev =>
        prev.map(addon =>
          addon.id === addonId
            ? { ...addon, status: 'not_installed' as PluginStatus }
            : addon
        )
      );

      toast.success(`${addons.find(a => a.id === addonId)?.name} uninstalled successfully!`);
    } catch (error) {
      console.error(`Failed to uninstall ${addonId}:`, error);
      toast.error(`Failed to uninstall ${addonId}`);
    } finally {
      setLoadingStates(prev => ({ ...prev, [addonId]: false }));
    }
  };

  const handleReinstall = async (addonId: string) => {
    if (!confirm('Are you sure you want to reinstall this add-on? This will remove the current installation and install fresh.')) {
      return;
    }

    setLoadingStates(prev => ({ ...prev, [addonId]: true }));

    try {
      setAddons(prev =>
        prev.map(addon =>
          addon.id === addonId
            ? { ...addon, status: 'installing' as PluginStatus }
            : addon
        )
      );

      await api.pluginReinstall();

      setAddons(prev =>
        prev.map(addon =>
          addon.id === addonId
            ? { ...addon, status: 'installed' as PluginStatus }
            : addon
        )
      );
      toast.success(`${addons.find(a => a.id === addonId)?.name} reinstalled successfully!`);
    } catch (error) {
      console.error(`Failed to reinstall ${addonId}:`, error);
      toast.error(`Failed to reinstall ${addonId}`);
      setAddons(prev =>
        prev.map(addon =>
          addon.id === addonId
            ? { ...addon, status: 'error' as PluginStatus }
            : addon
        )
      );
    } finally {
      setLoadingStates(prev => ({ ...prev, [addonId]: false }));
    }
  };

  const getStatusConfig = (status: PluginStatus) => {
    switch (status) {
      case 'not_installed':
        return {
          text: 'Not Installed',
          color: 'text-red-400',
          bg: 'bg-red-500/10',
          icon: <AlertCircle className="w-4 h-4" />
        };
      case 'installing':
        return {
          text: 'Installing...',
          color: 'text-yellow-400',
          bg: 'bg-yellow-500/10',
          icon: <Loader2 className="w-4 h-4 animate-spin" />
        };
      case 'installed':
        return {
          text: 'Installed',
          color: 'text-green-400',
          bg: 'bg-green-500/10',
          icon: <CheckCircle className="w-4 h-4" />
        };
      case 'error':
        return {
          text: 'Error',
          color: 'text-red-400',
          bg: 'bg-red-500/10',
          icon: <X className="w-4 h-4" />
        };
      default:
        return {
          text: 'Unknown',
          color: 'text-gray-400',
          bg: 'bg-gray-500/10',
          icon: <X className="w-4 h-4" />
        };
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-4xl mx-auto space-y-6"
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
          <Globe className="w-6 h-6 text-purple-400" />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold">Add-ons</h1>
          <p className="text-sm text-muted-foreground">
            Extend your experience with secure browser extensions
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {addons.map((addon) => {
          const statusConfig = getStatusConfig(addon.status);
          const isLoading = loadingStates[addon.id];

          return (
            <motion.div
              key={addon.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass rounded-2xl p-6 border-glow flex flex-col sm:flex-row sm:items-center gap-6"
            >
              <div className="flex items-start gap-4 flex-1">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center flex-shrink-0">
                  {addon.icon}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-lg">{addon.name}</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        {addon.description}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        {addon.size && (
                          <span>Size: {addon.size}</span>
                        )}
                        {addon.version && (
                          <span>Version: {addon.version}</span>
                        )}
                      </div>
                    </div>

                    <div className={cn(
                      "flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium",
                      statusConfig.bg,
                      statusConfig.color
                    )}>
                      {statusConfig.icon}
                      <span>{statusConfig.text}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-[200px]">
                {addon.status === 'not_installed' && (
                  <button
                    onClick={() => handleInstall(addon.id)}
                    disabled={isLoading}
                    className={cn(
                      'w-full py-2.5 rounded-xl font-medium transition-all flex items-center justify-center gap-2',
                      'bg-gradient-to-r from-primary to-accent text-black',
                      'hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Installing...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        Download & Install ({addon.size})
                      </>
                    )}
                  </button>
                )}

                {addon.status === 'installing' && (
                  <button
                    disabled
                    className="w-full py-2.5 rounded-xl font-medium bg-yellow-500/20 text-yellow-400 flex items-center justify-center gap-2"
                  >
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Installing...
                  </button>
                )}

                {addon.status === 'installed' && (
                  <div className="flex gap-2 w-full">
                    <button
                      onClick={() => handleUninstall(addon.id)}
                      disabled={isLoading}
                      className={cn(
                        'flex-1 py-2.5 rounded-xl font-medium transition-all flex items-center justify-center gap-2',
                        'bg-red-500/20 text-red-400 hover:bg-red-500/30',
                        'disabled:opacity-50 disabled:cursor-not-allowed'
                      )}
                    >
                      <Trash2 className="w-4 h-4" />
                      Uninstall
                    </button>
                    <button
                      onClick={() => handleReinstall(addon.id)}
                      disabled={isLoading}
                      className={cn(
                        'flex-1 py-2.5 rounded-xl font-medium transition-all flex items-center justify-center gap-2',
                        'bg-muted/50 text-foreground hover:bg-muted',
                        'disabled:opacity-50 disabled:cursor-not-allowed'
                      )}
                    >
                      <RotateCcw className="w-4 h-4" />
                      Reinstall
                    </button>
                  </div>
                )}

                {addon.status === 'error' && (
                  <button
                    onClick={() => handleInstall(addon.id)}
                    disabled={isLoading}
                    className={cn(
                      'w-full py-2.5 rounded-xl font-medium transition-all flex items-center justify-center gap-2',
                      'bg-gradient-to-r from-primary to-accent text-black',
                      'hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                  >
                    <RotateCcw className="w-4 h-4" />
                    Retry Installation
                  </button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="text-sm text-muted-foreground mt-8">
        <p className="mb-2">Add-ons enhance your secure browsing experience by providing additional privacy features and integration with the vault.</p>
        <p>All add-ons are securely sandboxed and do not have access to your vault contents without explicit permission.</p>
      </div>
    </motion.div>
  );
}