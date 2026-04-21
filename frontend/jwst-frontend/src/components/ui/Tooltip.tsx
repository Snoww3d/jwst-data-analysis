/**
 * Tooltip — JWST Discovery design-system primitive.
 *
 * A CSS-driven hover/focus tooltip. Wrap any interactive element:
 *
 *   <Tooltip content="Download FITS" placement="right">
 *     <button className="btn-icon">…</button>
 *   </Tooltip>
 *
 * For keyboard-shortcut or multi-line context, use <RichTooltip>:
 *
 *   <RichTooltip
 *     title="Quick search"
 *     body="Find targets by name, catalog ID, or constellation."
 *     kbd="⌘ K"
 *   >
 *     <button>Search</button>
 *   </RichTooltip>
 *
 * IMPORTANT: tooltips must never carry information the user can't get another way.
 * They're accents, not labels. If it matters, put it in the DOM.
 */

import { useId, type ReactNode } from 'react';
import './Tooltip.css';

type Placement = 'top' | 'right' | 'bottom' | 'left';

interface TooltipProps {
  content: string;
  children: ReactNode;
  placement?: Placement;
}

export function Tooltip({ content, children, placement = 'top' }: TooltipProps) {
  const id = useId();
  return (
    <span className="tooltip-host" aria-describedby={id}>
      {children}
      <span id={id} role="tooltip" className={`tooltip tooltip-${placement}`}>
        {content}
      </span>
    </span>
  );
}

interface RichTooltipProps {
  title: string;
  body?: ReactNode;
  kbd?: string;
  children: ReactNode;
  placement?: Placement;
}

export function RichTooltip({
  title,
  body,
  kbd,
  children,
  placement = 'bottom',
}: RichTooltipProps) {
  const id = useId();
  return (
    <span className="tooltip-host" aria-describedby={id}>
      {children}
      <span id={id} role="tooltip" className={`tooltip tooltip-rich tooltip-${placement}`}>
        <span className="tooltip-rich-title">{title}</span>
        {body && <span className="tooltip-rich-body">{body}</span>}
        {kbd && <span className="tooltip-rich-kbd">{kbd}</span>}
      </span>
    </span>
  );
}
