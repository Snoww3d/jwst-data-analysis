# JWST Discovery — Component Port

Drop-in TypeScript components for `Snoww3d/jwst-data-analysis`.

Your `frontend/jwst-frontend/src/index.css` **already contains every design token** these components need (colors, spacing, typography, shadows, z-index, motion). No token changes required.

## What's here

| File pair | What it gives you |
|---|---|
| `Modal.tsx` / `Modal.css` | Dialog with header / body / footer, Esc-to-close, focus trap, body scroll lock, destructive variant, `sm` / `md` / `lg` sizes. Portals to `document.body`. |
| `EmptyState.tsx` / `EmptyState.css` | Never-blank container pattern. Standard + compact sizes, optional dashed border. |
| `Progress.tsx` / `Progress.css` | Determinate, indeterminate, semantic tones (`success` / `warning` / `error`) + a `<Steps>` component for wizard progress. |
| `Tooltip.tsx` / `Tooltip.css` | Hover/focus tooltip, 4 placements. Includes `RichTooltip` for titled/multi-line + keyboard hint. |
| `toast.tsx` / `toast.css` | Re-export of `sonner` with a `<ToastProvider>` and JWST token overrides. Use `toast.success(...)`, `toast.error(...)`, etc. |

## Setup

`<ToastProvider />` is mounted once in `App.tsx`. It accepts an optional `position` prop (`top-left` · `top-right` · `top-center` · `bottom-left` · `bottom-right` · `bottom-center`) — the app currently uses `bottom-right`.

```tsx
import { ToastProvider } from './components/ui/toast';

<>
  <ToastProvider position="bottom-right" />
  <RouterProvider router={router} />
</>
```

Auth notifications (session expired, refresh failure) go through the same `toast.*` API — there's no separate `AuthToast` component. `sonner` is the only runtime dep and is already in `package.json`.

## Usage snippets

### Modal
```tsx
const [open, setOpen] = useState(false);

<Modal
  open={open}
  onClose={() => setOpen(false)}
  title="Export composite image"
  footer={
    <>
      <button className="btn-base btn-standard modal-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      <button className="btn-base btn-standard modal-btn-primary" onClick={startExport}>Start export</button>
    </>
  }
>
  Render the Hubble-palette recipe at full resolution (8192 × 8192) and deliver a 16-bit TIFF plus calibrated FITS bundle. Estimated 4 minutes on your quota.
</Modal>
```

For destructive actions, pass `destructive` and use `modal-btn-danger` on the primary footer button.

### EmptyState
```tsx
<EmptyState
  icon={<SearchIcon />}
  title="No targets match your search"
  description={<>We couldn&rsquo;t find a public JWST target for <em>&ldquo;{query}&rdquo;</em>.</>}
  actions={
    <>
      <button className="btn-base btn-standard empty-cta-primary" onClick={clear}>Browse all targets</button>
      <button className="btn-base btn-standard empty-cta-ghost" onClick={clear}>Clear search</button>
    </>
  }
/>
```

### Progress + Steps
```tsx
<Progress label="Stacking F444W frames" value={68} meta="6 of 9 frames · ~1m 12s" />
<Progress label="Contacting MAST archive…" />  {/* indeterminate */}

<Steps steps={['Target', 'Recipe', 'Preview', 'Export']} currentIndex={2} />
```

### Tooltip
```tsx
<Tooltip content="Download FITS" placement="right">
  <button className="btn-icon"><DownloadIcon /></button>
</Tooltip>

<RichTooltip title="Quick search" body="Find targets by name, catalog ID, or constellation." kbd="⌘ K">
  <button>Search</button>
</RichTooltip>
```

### Toast
```tsx
import { toast } from './components/ui/toast';

toast.success('Export complete', {
  description: 'Pillars of Creation · Hubble palette ready. 184 MB.',
  action: { label: 'Download', onClick: () => downloadComposite() },
});
toast.error('Processing failed', { description: 'MAST returned 504 on frame jw02739-t010.' });
toast.warning('Filter F187N missing');
toast('New observations available');  // default info tone
```

## Invariants

- **Dark-first.** All primitives assume the dark theme tokens. Don't override from a component.
- **Never a tooltip-only label** for critical actions — screen readers won't reliably announce them.
- **Toast duration:** info/success 5s, warning/error sticky. Already configured in `<ToastProvider>`.
- **Modals never nest.** If you need a second decision inside a modal, replace the content; don't stack.
- **Empty states always have a CTA.** If there's truly nothing the user can do, the screen shouldn't render at all.
