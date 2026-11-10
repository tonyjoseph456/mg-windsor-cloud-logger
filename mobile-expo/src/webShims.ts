/**
 * react-native-web shims & global font scaler for accessibility & small mobile screens
 */
import { Alert, Platform, Text, TextInput } from 'react-native';

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

let globalFontScale = 1.0;

export function getGlobalFontScale(): number {
  return globalFontScale;
}

export function setGlobalFontScale(scale: number): void {
  globalFontScale = Math.max(0.75, Math.min(1.3, Number(scale.toFixed(2))));
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--app-font-scale', String(globalFontScale));
  }
}

function scaleStyle(style: any, factor: number): any {
  if (factor === 1.0) return style;
  if (!style) {
    return { fontSize: Math.round(14 * factor * 10) / 10 };
  }
  if (Array.isArray(style)) {
    return style.map((s) => scaleStyle(s, factor));
  }
  if (typeof style !== 'object') return style;

  const hasFontSize = typeof style.fontSize === 'number';
  const hasLineHeight = typeof style.lineHeight === 'number';

  if (!hasFontSize && !hasLineHeight) return style;

  const scaled: any = { ...style };
  if (hasFontSize) {
    scaled.fontSize = Math.round(style.fontSize * factor * 10) / 10;
  }
  if (hasLineHeight) {
    scaled.lineHeight = Math.round(style.lineHeight * factor * 10) / 10;
  }
  return scaled;
}

// Global Text & TextInput font scaler for React Native Web & Native
if ((Text as any).render) {
  const origTextRender = (Text as any).render;
  (Text as any).render = function (props: any, ref: any) {
    if (globalFontScale === 1.0 || !props) {
      return origTextRender.call(this, props, ref);
    }
    const scaledStyle = scaleStyle(props.style, globalFontScale);
    return origTextRender.call(this, { ...props, style: scaledStyle }, ref);
  };
}

if ((TextInput as any).render) {
  const origInputRender = (TextInput as any).render;
  (TextInput as any).render = function (props: any, ref: any) {
    if (globalFontScale === 1.0 || !props) {
      return origInputRender.call(this, props, ref);
    }
    const scaledStyle = scaleStyle(props.style, globalFontScale);
    return origInputRender.call(this, { ...props, style: scaledStyle }, ref);
  };
}
