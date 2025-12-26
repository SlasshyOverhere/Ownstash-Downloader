import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    FolderOpen,
    Video,
    Music,
    Globe,
    RefreshCw,
    Info,
    ChevronRight,
    CheckCircle,
    AlertCircle,
    Loader2,
    Download,
    Sparkles,
    Cloud,
    Upload,
    HardDrive,
    CloudCog
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { staggerContainer, staggerItem, fadeInUp } from '@/lib/animations';
import { toast } from 'sonner';
import { open } from '@tauri-apps/plugin-dialog';
import api, { YtDlpInfo, UpdateInfo } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useData } from '@/contexts/DataContext';
import { UserAvatar } from '@/components/ui/UserAvatar';

interface SettingSectionProps {
    title: string;
    description: string;
    icon: React.ElementType;
    children: React.ReactNode;
}

function SettingSection({ title, description, icon: Icon, children }: SettingSectionProps) {
    return (
        <motion.div variants={staggerItem} className="glass rounded-2xl p-6 space-y-4">
            <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                    <h3 className="font-semibold">{title}</h3>
                    <p className="text-sm text-muted-foreground">{description}</p>
                </div>
            </div>
            <div className="pl-14">
                {children}
            </div>
        </motion.div>
    );
}

interface SettingRowProps {
    label: string;
    value?: string;
    action?: React.ReactNode;
    onClick?: () => void;
}

function SettingRow({ label, value, action, onClick }: SettingRowProps) {
    return (
        <div
            className={cn(
                'flex items-center justify-between py-3 border-b border-white/5 last:border-0',
                onClick && 'cursor-pointer hover:bg-white/5 -mx-3 px-3 rounded-lg transition-colors'
            )}
            onClick={onClick}
        >
            <span className="text-sm">{label}</span>
            <div className="flex items-center gap-2">
                {value && <span className="text-sm text-muted-foreground truncate max-w-[200px]">{value}</span>}
                {action}
                {onClick && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            </div>
        </div>
    );
}

interface ToggleProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
}

function Toggle({ checked, onChange }: ToggleProps) {
    return (
        <button
            onClick={() => onChange(!checked)}
            className={cn(
                'w-11 h-6 rounded-full transition-colors relative',
                checked ? 'bg-primary' : 'bg-muted'
            )}
        >
            <div
                className={cn(
                    'absolute w-4 h-4 rounded-full bg-white top-1 transition-transform',
                    checked ? 'translate-x-6' : 'translate-x-1'
                )}
            />
        </button>
    );
}

export function SettingsPage() {
    const { user } = useAuth();
    const { migrateLocalData, isSyncing, storageType, syncWithGDrive } = useData();
    const [downloadPath, setDownloadPath] = useState<string>('Loading...');
    const [embedThumbnails, setEmbedThumbnails] = useState(true);
    const [embedMetadata, setEmbedMetadata] = useState(true);
    const [preferredQuality, setPreferredQuality] = useState('best');
    const [audioFormat, setAudioFormat] = useState('mp3');
    const [audioBitrate, setAudioBitrate] = useState('320');
    const [minimizeToTray, setMinimizeToTray] = useState(false);
    const [useSponsorblock, setUseSponsorblock] = useState(true); // Default ON
    const [ytDlpInfo, setYtDlpInfo] = useState<YtDlpInfo | null>(null);
    const [ytDlpLoading, setYtDlpLoading] = useState(true);
    const [ytDlpError, setYtDlpError] = useState<string | null>(null);
    const [supportedPlatforms, setSupportedPlatforms] = useState<string[]>([]);
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [updateChecking, setUpdateChecking] = useState(false);
    const [updateInstalling, setUpdateInstalling] = useState(false);
    const [appVersion, setAppVersion] = useState('0.1.0');
    const [isMigrating, setIsMigrating] = useState(false);
    const [isSyncingGDrive, setIsSyncingGDrive] = useState(false);

    useEffect(() => {
        loadSettings();
        checkYtDlp();
        loadPlatforms();
        loadAppVersion();
        // Check for updates on startup
        checkForUpdates(true);
    }, []);

    const loadSettings = async () => {
        try {
            // Load download path
            const savedPath = await api.getSetting('download_path');
            if (savedPath) {
                setDownloadPath(savedPath);
            } else {
                const defaultPath = await api.getDefaultDownloadPath();
                setDownloadPath(defaultPath);
            }

            // Load other settings
            const savedEmbedThumbnails = await api.getSetting('embed_thumbnails');
            if (savedEmbedThumbnails !== null) setEmbedThumbnails(savedEmbedThumbnails === 'true');

            const savedEmbedMetadata = await api.getSetting('embed_metadata');
            if (savedEmbedMetadata !== null) setEmbedMetadata(savedEmbedMetadata === 'true');

            const savedQuality = await api.getSetting('preferred_quality');
            if (savedQuality) setPreferredQuality(savedQuality);

            const savedAudioFormat = await api.getSetting('audio_format');
            if (savedAudioFormat) setAudioFormat(savedAudioFormat);

            const savedBitrate = await api.getSetting('audio_bitrate');
            if (savedBitrate) setAudioBitrate(savedBitrate);

            const savedMinimizeToTray = await api.getSetting('minimize_to_tray');
            if (savedMinimizeToTray !== null) setMinimizeToTray(savedMinimizeToTray === 'true');

            const savedSponsorblock = await api.getSetting('use_sponsorblock');
            if (savedSponsorblock !== null) setUseSponsorblock(savedSponsorblock === 'true');
        } catch (err) {
            console.error('Failed to load settings:', err);
        }
    };

    const checkYtDlp = async () => {
        setYtDlpLoading(true);
        setYtDlpError(null);
        try {
            const info = await api.checkYtDlp();
            setYtDlpInfo(info);
        } catch (err) {
            setYtDlpError(err instanceof Error ? err.message : 'yt-dlp not found');
        } finally {
            setYtDlpLoading(false);
        }
    };

    const loadPlatforms = async () => {
        try {
            const platforms = await api.getSupportedPlatforms();
            setSupportedPlatforms(platforms);
        } catch (err) {
            console.error('Failed to load platforms:', err);
        }
    };

    const handleSelectDownloadPath = async () => {
        try {
            console.log('Opening folder dialog...');
            const selected = await open({
                directory: true,
                multiple: false,
                title: 'Select Download Folder',
            });

            console.log('Dialog result:', selected);

            if (selected && typeof selected === 'string') {
                setDownloadPath(selected);
                await api.saveSetting('download_path', selected);
                toast.success(`Download path updated to: ${selected}`);
            } else if (selected === null) {
                // User cancelled - do nothing
                console.log('Folder selection cancelled by user');
            }
        } catch (err) {
            console.error('Failed to select folder:', err);
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            toast.error(`Failed to select folder: ${errorMessage}`);
        }
    };

    const handleSaveSetting = async (key: string, value: string) => {
        try {
            await api.saveSetting(key, value);
            toast.success('Setting saved');
        } catch (err) {
            toast.error('Failed to save setting');
        }
    };

    const loadAppVersion = async () => {
        try {
            const version = await api.getCurrentVersion();
            setAppVersion(version);
        } catch (err) {
            console.error('Failed to get app version:', err);
        }
    };

    const checkForUpdates = async (silent: boolean = false) => {
        setUpdateChecking(true);
        try {
            const info = await api.checkForUpdates();
            setUpdateInfo(info);
            if (info.available && !silent) {
                toast.success(`Update available: v${info.version}`);
            } else if (!info.available && !silent) {
                toast.info('You are on the latest version!');
            }
        } catch (err) {
            if (!silent) {
                toast.error('Failed to check for updates');
            }
            console.error('Update check failed:', err);
        } finally {
            setUpdateChecking(false);
        }
    };

    const handleInstallUpdate = async () => {
        setUpdateInstalling(true);
        try {
            toast.info('Downloading update... This may take a moment.');
            await api.downloadAndInstallUpdate();
            toast.success('Update downloaded! The app will restart to apply the update.');
        } catch (err) {
            toast.error('Failed to install update');
            console.error('Update installation failed:', err);
        } finally {
            setUpdateInstalling(false);
        }
    };

    return (
        <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="max-w-3xl mx-auto space-y-6"
        >
            {/* Header */}
            <motion.div variants={fadeInUp}>
                <h1 className="text-3xl font-display font-bold">Settings</h1>
                <p className="text-muted-foreground">Configure your download preferences</p>
            </motion.div>

            {/* Download Location */}
            <SettingSection
                title="Download Location"
                description="Choose where to save your downloads"
                icon={FolderOpen}
            >
                <div className="space-y-3">
                    <SettingRow
                        label="Default folder"
                        value={downloadPath}
                        onClick={handleSelectDownloadPath}
                    />
                </div>
            </SettingSection>

            {/* Video Settings */}
            <SettingSection
                title="Video Settings"
                description="Default quality and format preferences"
                icon={Video}
            >
                <div className="space-y-3">
                    <div className="py-3 border-b border-white/5">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm">Preferred quality</span>
                        </div>
                        <select
                            value={preferredQuality}
                            onChange={(e) => {
                                setPreferredQuality(e.target.value);
                                handleSaveSetting('preferred_quality', e.target.value);
                            }}
                            className="w-full p-2 rounded-lg bg-muted/50 border border-white/10 text-sm"
                        >
                            <option value="best">Best available</option>
                            <option value="1080p">1080p Full HD</option>
                            <option value="720p">720p HD</option>
                            <option value="480p">480p SD</option>
                            <option value="360p">360p</option>
                        </select>
                    </div>
                    <SettingRow
                        label="Embed thumbnails"
                        action={
                            <Toggle
                                checked={embedThumbnails}
                                onChange={(checked) => {
                                    setEmbedThumbnails(checked);
                                    handleSaveSetting('embed_thumbnails', String(checked));
                                }}
                            />
                        }
                    />
                    <SettingRow
                        label="Embed metadata"
                        action={
                            <Toggle
                                checked={embedMetadata}
                                onChange={(checked) => {
                                    setEmbedMetadata(checked);
                                    handleSaveSetting('embed_metadata', String(checked));
                                }}
                            />
                        }
                    />
                    <SettingRow
                        label="Remove Sponsors (SponsorBlock)"
                        value="Skip intros, outros & sponsors"
                        action={
                            <Toggle
                                checked={useSponsorblock}
                                onChange={(checked) => {
                                    setUseSponsorblock(checked);
                                    handleSaveSetting('use_sponsorblock', String(checked));
                                }}
                            />
                        }
                    />
                </div>
            </SettingSection>

            {/* Audio Settings */}
            <SettingSection
                title="Audio Settings"
                description="Audio extraction and conversion options"
                icon={Music}
            >
                <div className="space-y-3">
                    <div className="py-3 border-b border-white/5">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm">Preferred format</span>
                        </div>
                        <select
                            value={audioFormat}
                            onChange={(e) => {
                                setAudioFormat(e.target.value);
                                handleSaveSetting('audio_format', e.target.value);
                            }}
                            className="w-full p-2 rounded-lg bg-muted/50 border border-white/10 text-sm"
                        >
                            <option value="mp3">MP3</option>
                            <option value="m4a">M4A (AAC)</option>
                            <option value="opus">OPUS</option>
                            <option value="flac">FLAC</option>
                            <option value="wav">WAV</option>
                        </select>
                    </div>
                    <div className="py-3 border-b border-white/5">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm">Bitrate</span>
                        </div>
                        <select
                            value={audioBitrate}
                            onChange={(e) => {
                                setAudioBitrate(e.target.value);
                                handleSaveSetting('audio_bitrate', e.target.value);
                            }}
                            className="w-full p-2 rounded-lg bg-muted/50 border border-white/10 text-sm"
                        >
                            <option value="320">320 kbps (Best)</option>
                            <option value="256">256 kbps</option>
                            <option value="192">192 kbps</option>
                            <option value="128">128 kbps</option>
                        </select>
                    </div>
                </div>
            </SettingSection>

            {/* yt-dlp Settings */}
            <SettingSection
                title="yt-dlp Engine"
                description="Backend downloader configuration"
                icon={RefreshCw}
            >
                <div className="space-y-3">
                    {/* Status indicator */}
                    <div className="p-4 rounded-xl bg-muted/30 border border-white/10">
                        {ytDlpLoading ? (
                            <div className="flex items-center gap-3">
                                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                                <span className="text-sm">Checking yt-dlp...</span>
                            </div>
                        ) : ytDlpError ? (
                            <div className="flex items-center gap-3">
                                <AlertCircle className="w-5 h-5 text-red-400" />
                                <div>
                                    <p className="text-sm font-medium text-red-400">yt-dlp Not Found</p>
                                    <p className="text-xs text-muted-foreground">Install with: winget install yt-dlp</p>
                                </div>
                            </div>
                        ) : ytDlpInfo ? (
                            <div className="flex items-center gap-3">
                                <CheckCircle className="w-5 h-5 text-white" />
                                <div>
                                    <p className="text-sm font-medium text-white">yt-dlp Ready</p>
                                    <p className="text-xs text-muted-foreground">
                                        Version: {ytDlpInfo.version}
                                        {ytDlpInfo.is_embedded && ' (embedded)'}
                                    </p>
                                </div>
                            </div>
                        ) : null}
                    </div>

                    {ytDlpInfo && (
                        <SettingRow
                            label="Path"
                            value={ytDlpInfo.path.length > 40
                                ? '...' + ytDlpInfo.path.slice(-37)
                                : ytDlpInfo.path}
                        />
                    )}

                    <div className="flex gap-2">
                        <button
                            onClick={checkYtDlp}
                            disabled={ytDlpLoading}
                            className={cn(
                                "btn-neon text-sm py-2 px-4 flex items-center gap-2",
                                ytDlpLoading && "opacity-50 cursor-not-allowed"
                            )}
                        >
                            <RefreshCw className={cn('w-4 h-4', ytDlpLoading && 'animate-spin')} />
                            Check Status
                        </button>
                    </div>
                </div>
            </SettingSection>

            {/* Supported Platforms */}
            <SettingSection
                title="Supported Platforms"
                description="yt-dlp supports 1000+ websites"
                icon={Globe}
            >
                <div className="flex flex-wrap gap-2">
                    {supportedPlatforms.map((platform, i) => (
                        <span
                            key={i}
                            className="px-3 py-1 rounded-full text-xs bg-primary/10 text-primary border border-primary/20"
                        >
                            {platform}
                        </span>
                    ))}
                </div>
            </SettingSection>

            {/* About */}
            <SettingSection
                title="About"
                description="Application information"
                icon={Info}
            >
                <div className="space-y-3">
                    <SettingRow
                        label="App Version"
                        value={appVersion}
                    />
                    <SettingRow
                        label="Developer"
                        value="Suman Patgiri"
                    />
                    <SettingRow
                        label="Powered by"
                        value="yt-dlp, Tauri, React"
                    />
                    <SettingRow
                        label="License"
                        value="MIT"
                    />
                </div>
            </SettingSection>

            {/* System Settings */}
            <SettingSection
                title="System"
                description="Application behavior and tray options"
                icon={CloudCog} // Reuse CloudCog or find another icon like Monitor/Power
            >
                <div className="space-y-3">
                    <SettingRow
                        label="Minimize to System Tray"
                        value="App stays running in background when closed"
                        action={
                            <Toggle
                                checked={minimizeToTray}
                                onChange={(checked) => {
                                    setMinimizeToTray(checked);
                                    handleSaveSetting('minimize_to_tray', String(checked));
                                }}
                            />
                        }
                    />
                </div>
            </SettingSection>

            {/* Cloud Sync */}
            <SettingSection
                title="Data Storage"
                description="Your data privacy and sync settings"
                icon={storageType === 'gdrive' ? Cloud : HardDrive}
            >
                <div className="space-y-4">
                    {/* Storage Type Indicator */}
                    <div className="p-4 rounded-xl bg-muted/30 border border-white/10">
                        {user && storageType === 'gdrive' ? (
                            <div className="flex items-start gap-3">
                                <UserAvatar
                                    photoURL={user.photoURL}
                                    displayName={user.displayName}
                                    email={user.email}
                                    size="md"
                                />
                                <div className="flex-1">
                                    <p className="text-sm font-medium">{user.displayName || 'User'}</p>
                                    <p className="text-xs text-muted-foreground">{user.email}</p>
                                    <div className="flex items-center gap-1.5 mt-2">
                                        {isSyncing ? (
                                            <>
                                                <Loader2 className="w-3 h-3 text-white/60 animate-spin" />
                                                <span className="text-xs text-white/60">Syncing to Google Drive...</span>
                                            </>
                                        ) : (
                                            <>
                                                <Cloud className="w-3 h-3 text-white" />
                                                <span className="text-xs text-white/80">Stored in your Google Drive</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : user ? (
                            <div className="flex items-start gap-3">
                                <UserAvatar
                                    photoURL={user.photoURL}
                                    displayName={user.displayName}
                                    email={user.email}
                                    size="md"
                                />
                                <div className="flex-1">
                                    <p className="text-sm font-medium">{user.displayName || 'User'}</p>
                                    <p className="text-xs text-muted-foreground">{user.email}</p>
                                    <div className="flex items-center gap-1.5 mt-2">
                                        <HardDrive className="w-3 h-3 text-yellow-400" />
                                        <span className="text-xs text-yellow-400/80">Local storage only</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Sign in with Google to sync to your Drive
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3">
                                <HardDrive className="w-5 h-5 text-muted-foreground" />
                                <div>
                                    <p className="text-sm font-medium text-muted-foreground">Local Storage</p>
                                    <p className="text-xs text-muted-foreground/70">
                                        Sign in with Google to sync data to your personal Drive
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Privacy notice */}
                    {storageType === 'gdrive' && (
                        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                            <div className="flex items-start gap-2">
                                <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                                <div>
                                    <p className="text-xs font-medium text-green-400">Privacy-First Storage</p>
                                    <p className="text-xs text-green-400/70 mt-0.5">
                                        Your data is stored in your own Google Drive, not our servers.
                                        Only you can access it.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Migration options (only show when logged in) */}
                    {user && (
                        <div className="space-y-3">
                            <SettingRow
                                label="Sync status"
                                value={isSyncing ? "Syncing..." : "Up to date"}
                                action={
                                    isSyncing ? (
                                        <Loader2 className="w-4 h-4 animate-spin text-white/60" />
                                    ) : (
                                        <CheckCircle className="w-4 h-4 text-white" />
                                    )
                                }
                            />
                            <div className="flex gap-2 pt-2 flex-wrap">
                                {/* Upload Local Data Button */}
                                <button
                                    onClick={async () => {
                                        setIsMigrating(true);
                                        try {
                                            await migrateLocalData();
                                            toast.success('Successfully migrated local data to cloud!');
                                        } catch (error) {
                                            toast.error('Failed to migrate data');
                                            console.error('Migration error:', error);
                                        } finally {
                                            setIsMigrating(false);
                                        }
                                    }}
                                    disabled={isMigrating || isSyncing || isSyncingGDrive}
                                    className={cn(
                                        "btn-neon text-sm py-2 px-4 flex items-center gap-2",
                                        (isMigrating || isSyncing || isSyncingGDrive) && "opacity-50 cursor-not-allowed"
                                    )}
                                >
                                    {isMigrating ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Upload className="w-4 h-4" />
                                    )}
                                    {isMigrating ? 'Migrating...' : 'Upload Local Data'}
                                </button>

                                {/* Full Sync with Google Drive Button */}
                                <button
                                    onClick={async () => {
                                        setIsSyncingGDrive(true);
                                        try {
                                            const result = await syncWithGDrive();
                                            if (result.success) {
                                                toast.success(`✓ ${result.message}`);
                                            } else {
                                                toast.error(result.message);
                                            }
                                        } catch (error) {
                                            toast.error('Sync failed. Please try again.');
                                            console.error('Sync error:', error);
                                        } finally {
                                            setIsSyncingGDrive(false);
                                        }
                                    }}
                                    disabled={isMigrating || isSyncing || isSyncingGDrive}
                                    className={cn(
                                        "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium",
                                        "bg-gradient-to-r from-blue-600 to-cyan-600 text-white",
                                        "hover:from-blue-500 hover:to-cyan-500 transition-all",
                                        "shadow-lg shadow-blue-500/20",
                                        (isMigrating || isSyncing || isSyncingGDrive) && "opacity-50 cursor-not-allowed"
                                    )}
                                >
                                    {isSyncingGDrive ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <CloudCog className="w-4 h-4" />
                                    )}
                                    {isSyncingGDrive ? 'Syncing...' : 'Sync with Google Drive'}
                                </button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                <strong>Upload Local Data:</strong> Pushes your local data to Google Drive.<br />
                                <strong>Sync with Google Drive:</strong> Performs a full two-way sync, merging data from both sources.
                            </p>
                        </div>
                    )}
                </div>
            </SettingSection>

            {/* App Updates */}
            <SettingSection
                title="App Updates"
                description="Check for and install app updates"
                icon={Sparkles}
            >
                <div className="space-y-4">
                    {/* Update status */}
                    <div className="p-4 rounded-xl bg-muted/30 border border-white/10">
                        {updateChecking ? (
                            <div className="flex items-center gap-3">
                                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                                <span className="text-sm">Checking for updates...</span>
                            </div>
                        ) : updateInfo?.available ? (
                            <div className="flex items-start gap-3">
                                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-white/20 to-white/10 flex items-center justify-center shrink-0">
                                    <Download className="w-5 h-5 text-white" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-white">Update Available!</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Version {updateInfo.version} is available (current: {updateInfo.current_version})
                                    </p>
                                    {updateInfo.body && (
                                        <p className="text-xs text-muted-foreground mt-2 line-clamp-3">
                                            {updateInfo.body}
                                        </p>
                                    )}
                                </div>
                            </div>
                        ) : updateInfo ? (
                            <div className="flex items-center gap-3">
                                <CheckCircle className="w-5 h-5 text-white" />
                                <div>
                                    <p className="text-sm font-medium text-white">You're up to date!</p>
                                    <p className="text-xs text-muted-foreground">
                                        Current version: {updateInfo.current_version}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3">
                                <Info className="w-5 h-5 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">Click "Check for Updates" to see if there's a new version</span>
                            </div>
                        )}
                    </div>

                    {/* Update actions */}
                    <div className="flex gap-2">
                        <button
                            onClick={() => checkForUpdates(false)}
                            disabled={updateChecking || updateInstalling}
                            className={cn(
                                "btn-neon text-sm py-2 px-4 flex items-center gap-2",
                                (updateChecking || updateInstalling) && "opacity-50 cursor-not-allowed"
                            )}
                        >
                            <RefreshCw className={cn('w-4 h-4', updateChecking && 'animate-spin')} />
                            Check for Updates
                        </button>
                        {updateInfo?.available && (
                            <button
                                onClick={handleInstallUpdate}
                                disabled={updateInstalling}
                                className={cn(
                                    "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium",
                                    "bg-white text-black",
                                    "hover:bg-white/90 transition-all",
                                    updateInstalling && "opacity-50 cursor-not-allowed"
                                )}
                            >
                                {updateInstalling ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Installing...
                                    </>
                                ) : (
                                    <>
                                        <Download className="w-4 h-4" />
                                        Install Update
                                    </>
                                )}
                            </button>
                        )}
                    </div>

                    <p className="text-xs text-muted-foreground">
                        Updates are downloaded from GitHub Releases. The app will restart after installing an update.
                    </p>
                </div>
            </SettingSection>
        </motion.div>
    );
}
