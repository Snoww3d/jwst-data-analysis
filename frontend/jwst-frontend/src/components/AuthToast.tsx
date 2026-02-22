/**
 * Minimal fixed-position toast for auth-related messages.
 * Exposed via useImperativeHandle so AuthContext
 * can call toastRef.current.show(message, variant).
 */

import { useImperativeHandle, useState, useCallback, type Ref } from 'react';
import './AuthToast.css';

export type ToastVariant = 'warning' | 'error';

export interface AuthToastHandle {
  show: (message: string, variant: ToastVariant) => void;
  hide: () => void;
}

interface AuthToastProps {
  ref?: Ref<AuthToastHandle>;
}

export const AuthToast = function AuthToast({ ref }: AuthToastProps) {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');
  const [variant, setVariant] = useState<ToastVariant>('warning');

  const show = useCallback((msg: string, v: ToastVariant) => {
    setMessage(msg);
    setVariant(v);
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    setVisible(false);
  }, []);

  useImperativeHandle(ref, () => ({ show, hide }), [show, hide]);

  const classes = ['auth-toast', visible ? 'auth-toast--visible' : '', `auth-toast--${variant}`]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} role="alert" aria-live="assertive">
      <span>{message}</span>
      {visible && (
        <button className="auth-toast__dismiss" onClick={hide} aria-label="Dismiss">
          &times;
        </button>
      )}
    </div>
  );
};
