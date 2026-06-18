import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  ReactNode,
} from 'react';

type ButtonProps = {
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'sm';
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ variant = 'primary', size, className, children, ...rest }: ButtonProps) {
  const cls = ['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  error,
}: {
  label: string;
  children: ReactNode;
  error?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error ? <span className="error-text">{error}</span> : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function Select({ children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className="select" {...rest}>
      {children}
    </select>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={['card', className ?? ''].filter(Boolean).join(' ')}>{children}</div>;
}

export function Badge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status.replace('_', ' ')}</span>;
}

export function Spinner() {
  return (
    <div className="center-load">
      <div className="spinner" />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Stars({ value, small }: { value: number; small?: boolean }) {
  const full = Math.round(value);
  return (
    <span className={`stars ${small ? 'stars-sm' : ''}`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={i < full ? 'star on' : 'star'}>
          ★
        </span>
      ))}
    </span>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return <div className="avatar">{initials}</div>;
}
