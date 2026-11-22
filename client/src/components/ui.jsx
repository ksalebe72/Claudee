import React, { createContext, useContext, useEffect, useState } from 'react';
import { label, STATUS_TONE } from '../utils.js';

export const MetaContext = createContext(null);
export const useMeta = () => useContext(MetaContext);

export function Badge({ status, children, tone }) {
  return <span className={`badge tone-${tone || STATUS_TONE[status] || 'gray'}`}>{children ?? label(status)}</span>;
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      <div className="row gap">{children}</div>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Field({ label: l, children, hint }) {
  return (
    <label className="field">
      <span>{l}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

/** Tablero kanban con drag & drop nativo. */
export function Kanban({ columns, items, getColumn, onMove, renderCard, columnFooter }) {
  const [over, setOver] = useState(null);
  return (
    <div className="kanban">
      {columns.map((col) => {
        const list = items.filter((i) => getColumn(i) === col.id);
        return (
          <div
            key={col.id}
            className={`kanban-col ${over === col.id ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(col.id); }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = Number(e.dataTransfer.getData('text/plain'));
              const item = items.find((i) => i.id === id);
              if (item && getColumn(item) !== col.id) onMove(item, col.id);
            }}
          >
            <div className="kanban-head">
              <span>{col.title}</span>
              <span className="count">{list.length}</span>
            </div>
            {columnFooter && <div className="kanban-sub">{columnFooter(list)}</div>}
            <div className="kanban-list">
              {list.map((i) => (
                <div key={i.id} className="kanban-card" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i.id))}>
                  {renderCard(i)}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState(null);
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(null), 3500); return () => clearTimeout(t); } }, [msg]);
  const node = msg ? <div className={`toast ${msg.error ? 'error' : ''}`}>{msg.text}</div> : null;
  return [node, (text, error = false) => setMsg({ text, error })];
}
