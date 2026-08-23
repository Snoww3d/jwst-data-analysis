# JWST Discovery — Component Port

Drop-in TypeScript components for `Snoww3d/jwst-data-analysis`.

Your `frontend/jwst-frontend/src/index.css` **already contains every design token** these components need (colors, spacing, typography, shadows, z-index, motion). No token changes required.

## What's here

| File pair                           | What it gives you                                                                                                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Modal.tsx` / `Modal.css`           | Dialog with header / body / footer, Esc-to-close, focus trap, body scroll lock, destructive variant, `sm` / `md` / `lg` sizes. Portals to `document.body`.                                         |
| `ImagePreviewLightbox.tsx` / `.css` | Zoom/pan lightbox for _ephemeral_ images (no library record). Fetches bytes via an auth-aware `loadImage` and owns the object-URL lifecycle. Same Esc / backdrop / focus-trap contract as `Modal`. |
| `EmptyState.tsx` / `EmptyState.css` | Never-blank container pattern. Standard + compact sizes, optional dashed border.                                                                                                                   |
| `toast.tsx` / `toast.css`           | Re-export of `sonner` with a `<ToastProvider>` and JWST token overrides. Use `toast.success(...)`, `toast.error(...)`, etc.                                                                        |
| `SplitView.tsx` / `SplitView.css`   | Two horizontal panes with a draggable divider (`role="separator"`, `aria-valuenow`, ←/→ + Home/End). Stacks below 1024 px, `collapsed` hides the secondary pane, ratio persisted per `storageKey`. |

## Setup

`<ToastProvider />` is mounted once in `App.tsx`. It accepts an optional `position` prop (`top-left` · `top-right` · `top-center` · `bottom-left` · `bottom-right` · `bottom-center`) — the app currently uses `bottom-right`.

```tsx
import { ToastProvider } from './components/ui/toast';

<>
  <ToastProvider position="bottom-right" />
  <RouterProvider router={router} />
</>;
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
      <button className="btn-base btn-standard modal-btn-ghost" onClick={() => setOpen(false)}>
        Cancel
      </button>
      <button className="btn-base btn-standard modal-btn-primary" onClick={startExport}>
        Start export
      </button>
    </>
  }
>
  Render the Hubble-palette recipe at full resolution (8192 × 8192) and deliver a 16-bit TIFF plus
  calibrated FITS bundle. Estimated 4 minutes on your quota.
</Modal>;
```

For destructive actions, pass `destructive` and use `modal-btn-danger` on the primary footer button.

### EmptyState

```tsx
<EmptyState
  icon={<SearchIcon />}
  title="No targets match your search"
  description={
    <>
      We couldn&rsquo;t find a public JWST target for <em>&ldquo;{query}&rdquo;</em>.
    </>
  }
  actions={
    <>
      <button className="btn-base btn-standard empty-cta-primary" onClick={clear}>
        Browse all targets
      </button>
      <button className="btn-base btn-standard empty-cta-ghost" onClick={clear}>
        Clear search
      </button>
    </>
  }
/>
```

### SplitView

```tsx
<SplitView
  storageKey="mast-search"
  collapsed={view !== 'split'}
  primary={<ResultsTable … />}
  secondary={<SkyMap … />}
/>
```

Props: `primary` / `secondary` (nodes), `storageKey` (ratio persists in
`localStorage['split_view_ratio:<key>']`), `collapsed`, `defaultRatio` (0.55),
`minRatio` / `maxRatio` (0.25 / 0.75), `label` (divider name), `onRatioChange`.
The divider is a keyboard-operable separator: ←/→ move it 2 % at a time,
Home/End jump to the limits. Below 1024 px the panes stack (primary first) and
the divider is hidden. The panes get `min-width: 0` so tables and canvases
inside them scroll rather than widen the page.

### Toast

```tsx
import { toast } from './components/ui/toast';

toast.success('Export complete', {
  description: 'Pillars of Creation · Hubble palette ready. 184 MB.',
  action: { label: 'Download', onClick: () => downloadComposite() },
});
toast.error('Processing failed', { description: 'MAST returned 504 on frame jw02739-t010.' });
toast.warning('Filter F187N missing');
toast('New observations available'); // default info tone
```

## Invariants

- **Dark-first.** All primitives assume the dark theme tokens. Don't override from a component.
- **Never a tooltip-only label** for critical actions — screen readers won't reliably announce them.
- **Toast duration:** info/success 5s, warning/error sticky. Already configured in `<ToastProvider>`.
- **Modals never nest.** If you need a second decision inside a modal, replace the content; don't stack.
- **Empty states always have a CTA.** If there's truly nothing the user can do, the screen shouldn't render at all.
