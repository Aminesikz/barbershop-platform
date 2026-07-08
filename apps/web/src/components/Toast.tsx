import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type ToastType = 'info' | 'error' | 'success';
interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

const ToastCtx = createContext<(message: string, type?: ToastType) => void>(() => {});

export function useToast(): (message: string, type?: ToastType) => void {
  return useContext(ToastCtx);
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, type: ToastType = 'info') => {
    const id = nextId++;
    // Identical message already on screen → don't stack a duplicate (e.g. several
    // in-flight requests all failing with the same "signed out" error).
    setToasts((t) => (t.some((x) => x.message === message) ? t : [...t, { id, message, type }]));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
