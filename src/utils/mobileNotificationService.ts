/**
 * Mobile Native Notification Service for FRIDAY APK
 * Bridges Android NotificationManager & Lockscreen via @capacitor/local-notifications
 */

import { LocalNotifications, ActionPerformed } from '@capacitor/local-notifications';

export interface MusicNotificationData {
  trackName: string;
  artistName: string;
  albumArt?: string;
  isPlaying: boolean;
  isYouTube?: boolean;
  quality?: string;
}

export interface MusicActionCallbacks {
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onStop: () => void;
}

class MobileNotificationService {
  private isInitialized = false;
  private permissionGranted = false;
  private currentNotificationId = 99991;
  private callbacks: MusicActionCallbacks | null = null;

  /**
   * Check if running in a native Capacitor environment (Android APK / iOS)
   */
  public isNative(): boolean {
    if (typeof window === 'undefined') return false;
    return typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor.isNativePlatform();
  }

  /**
   * Initialize notification channels and action types for Android lockscreen
   */
  public async initialize(callbacks?: MusicActionCallbacks): Promise<boolean> {
    if (callbacks) {
      this.callbacks = callbacks;
    }

    if (!this.isNative()) {
      return false;
    }

    if (this.isInitialized) {
      return this.permissionGranted;
    }

    try {
      // 1. Request Runtime Permission (Required for Android 13+)
      const permStatus = await LocalNotifications.checkPermissions();
      if (permStatus.display !== 'granted') {
        const req = await LocalNotifications.requestPermissions();
        this.permissionGranted = req.display === 'granted';
      } else {
        this.permissionGranted = true;
      }

      // 2. Register Media Action Buttons
      await LocalNotifications.registerActionTypes({
        types: [
          {
            id: 'FRIDAY_MUSIC_CONTROLS',
            actions: [
              {
                id: 'ACTION_PREV',
                title: '⏮ Prev',
              },
              {
                id: 'ACTION_PLAY_PAUSE',
                title: '⏯ Play/Pause',
              },
              {
                id: 'ACTION_NEXT',
                title: '⏭ Next',
              },
              {
                id: 'ACTION_STOP',
                title: '⏹ Stop',
                destructive: true,
              },
            ],
          },
        ],
      });

      // 3. Register Action Listeners
      LocalNotifications.addListener('localNotificationActionPerformed', (action: ActionPerformed) => {
        const actionId = action.actionId;
        console.log('[MobileNotification] 📲 Action performed on lockscreen/notification:', actionId);

        if (!this.callbacks) return;

        if (actionId === 'ACTION_PLAY_PAUSE') {
          this.callbacks.onPlayPause();
        } else if (actionId === 'ACTION_NEXT') {
          this.callbacks.onNext();
        } else if (actionId === 'ACTION_PREV') {
          this.callbacks.onPrev();
        } else if (actionId === 'ACTION_STOP') {
          this.callbacks.onStop();
        }
      });

      // 4. Create High-Priority Notification Channel for Android
      try {
        await LocalNotifications.createChannel({
          id: 'friday_music_playback',
          name: 'FRIDAY Music Playback',
          description: 'Lock-screen and status bar media player with controls',
          importance: 4, // High importance
          visibility: 1, // Public on lockscreen
          vibration: false,
          sound: undefined,
        });
      } catch (e) {
        console.warn('[MobileNotification] Channel creation note:', e);
      }

      this.isInitialized = true;
      return this.permissionGranted;
    } catch (err) {
      console.warn('[MobileNotification] Init error:', err);
      return false;
    }
  }

  /**
   * Set or update action callbacks from React player
   */
  public setCallbacks(callbacks: MusicActionCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Show or update rich media notification on Android status bar & lock-screen
   */
  public async showMusicNotification(data: MusicNotificationData): Promise<void> {
    if (!this.isNative()) return;

    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const sourceLabel = data.isYouTube ? '🔴 YouTube Pro Safe' : '⚡ JioSaavn 320k HD';
      const playState = data.isPlaying ? '▶ Now Playing' : '⏸ Paused';

      await LocalNotifications.schedule({
        notifications: [
          {
            id: this.currentNotificationId,
            title: `🎵 ${data.trackName}`,
            body: `${data.artistName || 'FRIDAY Music'} • ${sourceLabel} (${playState})`,
            ongoing: data.isPlaying, // Ongoing so user can't accidentally swipe it away while playing
            autoCancel: false,
            channelId: 'friday_music_playback',
            actionTypeId: 'FRIDAY_MUSIC_CONTROLS',
            extra: {
              type: 'music_control',
            },
          },
        ],
      });
    } catch (err) {
      console.warn('[MobileNotification] Schedule notification warning:', err);
    }
  }

  /**
   * Dismiss the notification when music is stopped
   */
  public async clearMusicNotification(): Promise<void> {
    if (!this.isNative()) return;

    try {
      await LocalNotifications.cancel({
        notifications: [{ id: this.currentNotificationId }],
      });
    } catch (err) {
      console.warn('[MobileNotification] Clear notification warning:', err);
    }
  }
}

export const mobileNotificationService = new MobileNotificationService();
