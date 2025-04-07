export class NotificationService {
  private static instance: NotificationService

  private constructor() {
    // Private constructor for singleton pattern
  }

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService()
    }
    return NotificationService.instance
  }

  public async requestPermission(): Promise<boolean> {
    if (!this.isSupported()) {
      console.warn('Notifications are not supported in this browser')
      return false
    }

    try {
      const permission = await Notification.requestPermission()
      return permission === 'granted'
    } catch (error) {
      console.error('Error requesting notification permission:', error)
      return false
    }
  }

  public async showNotification(title: string, options?: NotificationOptions): Promise<void> {
    // Do not show notification if window is focused
    try {
      const isFocused = await window.appWindow?.isFocused?.()
      if (isFocused) {
        return
      }
    } catch (error) {
      console.warn('Failed to check window focus state:', error)
      // Continue processing with notification display if error occurs
    }

    if (!this.isSupported()) {
      console.warn('Notifications are not supported in this browser')
      return
    }

    if (Notification.permission !== 'granted') {
      const permitted = await this.requestPermission()
      if (!permitted) {
        console.warn('Notification permission not granted')
        return
      }
    }

    try {
      const defaultOptions: NotificationOptions = {
        body: 'Response from AI received',
        icon: '/icon.png', // Use application icon
        silent: false, // Enable notification sound
        ...options
      }

      new Notification(title, defaultOptions)
    } catch (error) {
      console.error('Error showing notification:', error)
    }
  }

  private isSupported(): boolean {
    return 'Notification' in window
  }
}

export const notificationService = NotificationService.getInstance()
