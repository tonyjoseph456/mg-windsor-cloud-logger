/**
 * react-native-web ships a no-op Alert.alert. Polyfill it with window.alert / window.confirm
 * so the app's dialogs (and destructive-action confirmations) work in the PWA.
 */
import { Alert, Platform } from 'react-native';

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  (Alert as any).alert = (title: string, message?: string, buttons?: any[]) => {
    const text = [title, message].filter(Boolean).join('\n\n');
    if (!buttons || buttons.length <= 1) {
      window.alert(text);
      buttons?.[0]?.onPress?.();
      return;
    }
    const cancel = buttons.find((b) => b.style === 'cancel');
    const action = buttons.find((b) => b.style !== 'cancel') || buttons[buttons.length - 1];
    if (window.confirm(text)) {
      action?.onPress?.();
    } else {
      cancel?.onPress?.();
    }
  };
}
