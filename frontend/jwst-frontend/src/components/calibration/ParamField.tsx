/**
 * One curated parameter control (#1737) — a real input with a label and an
 * explanation, instead of a row of three free-text boxes.
 */

import { useId } from 'react';
import { decodeValue, encodeValue, type ParamSpec } from './paramCatalog';
import './ParamField.css';

interface ParamFieldProps {
  spec: ParamSpec;
  /** Stored (JSON-ish) value, as the run request carries it. */
  value: string;
  onChange: (nextStoredValue: string) => void;
  onRemove: () => void;
}

export function ParamField({ spec, value, onChange, onRemove }: ParamFieldProps) {
  const id = useId();
  const shown = decodeValue(value);
  const set = (v: string) => onChange(encodeValue(spec, v));

  return (
    <div className="param-field">
      <div className="param-field-main">
        <label className="param-field-label" htmlFor={id}>
          {spec.label}
        </label>

        {spec.control === 'boolean' && (
          <input
            id={id}
            type="checkbox"
            checked={shown === 'true'}
            onChange={(e) => set(e.target.checked ? 'true' : 'false')}
          />
        )}

        {spec.control === 'enum' && (
          <select id={id} value={shown} onChange={(e) => set(e.target.value)}>
            {!spec.options?.includes(shown) && <option value={shown}>{shown || '—'}</option>}
            {spec.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        )}

        {spec.control === 'number' && (
          <input
            id={id}
            type="number"
            step="any"
            value={shown}
            onChange={(e) => set(e.target.value)}
          />
        )}

        {spec.control === 'text' && (
          <input id={id} type="text" value={shown} onChange={(e) => set(e.target.value)} />
        )}

        <button
          type="button"
          className="btn-base btn-compact param-field-remove"
          onClick={onRemove}
          aria-label={`Remove ${spec.label}`}
        >
          Remove
        </button>
      </div>
      <p className="param-field-help">
        {spec.help}{' '}
        <code>
          {spec.step}.{spec.param}
        </code>
      </p>
    </div>
  );
}
