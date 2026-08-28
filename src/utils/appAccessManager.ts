// ── Friday AI App Access & Device Permissions Manager ─────────────────────────

export interface PermissionItemConfig {
    id: string;
    title: string;
    description: string;
    defaultAllowed: boolean;
    category: 'system' | 'media' | 'communication' | 'network';
    browserPermissionName?: PermissionName | string;
    settingType: 'android_settings' | 'browser_prompt' | 'file_picker' | 'bluetooth_picker' | 'info_guide';
}

export const APP_ACCESS_ITEMS: PermissionItemConfig[] = [
    {
        id: 'all_files',
        title: 'All files access',
        description: 'Used to show device files, photos, and media in File Explorer on your PC / Friday',
        defaultAllowed: true,
        category: 'system',
        settingType: 'file_picker',
    },
    {
        id: 'call_logs',
        title: 'Call logs',
        description: 'Used to show your call history on your PC / Friday',
        defaultAllowed: true,
        category: 'communication',
        settingType: 'android_settings',
    },
    {
        id: 'camera',
        title: 'Camera',
        description: 'Used to scan QR codes to link devices, or to use this mobile device as a connected camera on your PC',
        defaultAllowed: true,
        category: 'media',
        browserPermissionName: 'camera',
        settingType: 'browser_prompt',
    },
    {
        id: 'contacts',
        title: 'Contacts',
        description: 'Used to show contact names in your call history and messages list on your PC',
        defaultAllowed: true,
        category: 'communication',
        settingType: 'android_settings',
    },
    {
        id: 'microphone',
        title: 'Microphone',
        description: 'Used to stream audio on your PC / AI voice commands',
        defaultAllowed: false,
        category: 'media',
        browserPermissionName: 'microphone',
        settingType: 'browser_prompt',
    },
    {
        id: 'nearby_devices',
        title: 'Nearby devices',
        description: 'Used for proximal discovery, Bluetooth wake, Instant hotspot, and to improve file transfers with Friday',
        defaultAllowed: true,
        category: 'network',
        settingType: 'bluetooth_picker',
    },
    {
        id: 'notifications',
        title: 'Notifications',
        description: 'Used to send notifications to your mobile device when you\'re connected to your PC / Friday',
        defaultAllowed: true,
        category: 'system',
        browserPermissionName: 'notifications',
        settingType: 'browser_prompt',
    },
    {
        id: 'notifications_access',
        title: 'Notifications access',
        description: 'Used to read, reply, and control app notifications on your PC / Friday',
        defaultAllowed: true,
        category: 'system',
        settingType: 'android_settings',
    },
    {
        id: 'phone',
        title: 'Phone',
        description: 'Used to make and manage calls directly from your PC / Friday',
        defaultAllowed: true,
        category: 'communication',
        settingType: 'android_settings',
    },
    {
        id: 'photos_videos',
        title: 'Photos and videos',
        description: 'Used to access photos and videos on your mobile device',
        defaultAllowed: true,
        category: 'media',
        settingType: 'file_picker',
    },
    {
        id: 'sms',
        title: 'SMS',
        description: 'Used to view and send SMS messages from your PC / Friday',
        defaultAllowed: true,
        category: 'communication',
        settingType: 'android_settings',
    },
    {
        id: 'device_location',
        title: 'Device location',
        description: 'Used to provide location-based Friday and Windows experiences',
        defaultAllowed: true,
        category: 'system',
        browserPermissionName: 'geolocation',
        settingType: 'browser_prompt',
    },
];

const STORAGE_KEY = 'friday_app_access_preferences';

export function getAppAccessPreferences(): Record<string, boolean> {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            const merged: Record<string, boolean> = {};
            APP_ACCESS_ITEMS.forEach(item => {
                merged[item.id] = parsed[item.id] !== undefined ? !!parsed[item.id] : item.defaultAllowed;
            });
            return merged;
        }
    } catch (e) {
        console.error('Error reading app access preferences:', e);
    }

    const initial: Record<string, boolean> = {};
    APP_ACCESS_ITEMS.forEach(item => {
        initial[item.id] = item.defaultAllowed;
    });
    return initial;
}

export function saveAppAccessPreference(id: string, allowed: boolean): Record<string, boolean> {
    const current = getAppAccessPreferences();
    current[id] = allowed;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch (e) {
        console.error('Error saving app access preference:', e);
    }
    return current;
}

/**
 * Trigger system or browser setting / permission prompt for a specific permission item
 */
export async function openPermissionSettings(item: PermissionItemConfig): Promise<{ status: 'prompted' | 'opened' | 'guided'; message?: string }> {
    // 1. If running in Capacitor / Android Native App
    if (typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.()) {
        try {
            // Android App Settings Intent via window.location or Capacitor App plugin
            window.location.href = 'app-settings:';
            return { status: 'opened', message: 'Opening Phone App Settings...' };
        } catch {
            // fallback
        }
    }

    // 2. Specific Browser / Device handling
    switch (item.id) {
        case 'camera':
            if (navigator.mediaDevices?.getUserMedia) {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                    stream.getTracks().forEach(t => t.stop());
                    saveAppAccessPreference(item.id, true);
                    return { status: 'prompted', message: 'Camera permission granted!' };
                } catch {
                    return { status: 'guided', message: 'Camera access blocked in browser. Enable in Site Settings.' };
                }
            }
            break;

        case 'microphone':
            if (navigator.mediaDevices?.getUserMedia) {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    stream.getTracks().forEach(t => t.stop());
                    saveAppAccessPreference(item.id, true);
                    return { status: 'prompted', message: 'Microphone permission granted!' };
                } catch {
                    return { status: 'guided', message: 'Microphone access blocked in browser. Enable in Site Settings.' };
                }
            }
            break;

        case 'notifications':
        case 'notifications_access':
            if ('Notification' in window) {
                try {
                    const res = await Notification.requestPermission();
                    if (res === 'granted') {
                        saveAppAccessPreference(item.id, true);
                        return { status: 'prompted', message: 'Notification permission granted!' };
                    } else {
                        return { status: 'guided', message: 'Notifications denied. Please allow in browser / phone settings.' };
                    }
                } catch {
                    // ignore
                }
            }
            break;

        case 'device_location':
            if ('geolocation' in navigator) {
                try {
                    await new Promise((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
                    });
                    saveAppAccessPreference(item.id, true);
                    return { status: 'prompted', message: 'Location permission granted!' };
                } catch {
                    return { status: 'guided', message: 'Location denied. Please allow in browser / phone settings.' };
                }
            }
            break;

        case 'nearby_devices':
            if ((navigator as any).bluetooth) {
                try {
                    await (navigator as any).bluetooth.requestDevice({ acceptAllDevices: true });
                    saveAppAccessPreference(item.id, true);
                    return { status: 'prompted', message: 'Nearby Bluetooth pairing enabled!' };
                } catch {
                    return { status: 'guided', message: 'Bluetooth / Nearby devices search opened.' };
                }
            }
            break;

        case 'all_files':
        case 'photos_videos':
            try {
                if ((window as any).showOpenFilePicker) {
                    await (window as any).showOpenFilePicker();
                    saveAppAccessPreference(item.id, true);
                    return { status: 'prompted', message: 'File access confirmed!' };
                }
            } catch {
                // ignore cancel
            }
            break;
    }

    // Default return for Android / Browser settings guidance
    return {
        status: 'guided',
        message: `Phone / Device settings required for ${item.title}. Open your Device Settings > Apps > Friday AI > Permissions to allow full access.`,
    };
}
