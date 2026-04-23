const { useState, useEffect } = React;

/* ---------- Data ---------- */

const TARGETS = [
  { id: 'm16', name: 'Pillars of Creation', catalog: 'M16 / Eagle Nebula', ra: '18h 18m 48s', dec: '-13° 49′', constellation: 'Serpens', type: 'Emission Nebula', dist: '6,500 ly', potential: 'great', recipeCount: 12,
    blurb: 'Towering columns of cool interstellar gas and dust, sculpted by intense ultraviolet radiation from nearby young stars. One of JWST\u2019s most iconic infrared targets.' },
  { id: 'ngc1300', name: 'Barred Spiral NGC 1300', catalog: 'NGC 1300', ra: '03h 19m 41s', dec: '-19° 24′', constellation: 'Eridanus', type: 'Barred Spiral Galaxy', dist: '61 Mly', potential: 'great', recipeCount: 8, blurb: 'A textbook barred spiral whose dust lanes resolve beautifully into clumpy star-forming structure under JWST\u2019s mid-infrared eye.' },
  { id: 'carina', name: 'Cosmic Cliffs', catalog: 'NGC 3324 / Carina', ra: '10h 37m 18s', dec: '-58° 37′', constellation: 'Carina', type: 'Star-forming region', dist: '7,600 ly', potential: 'great', recipeCount: 15, blurb: 'The edge of a bubble blown by hot young stars. Jets and outflows from protostars pierce the wall in crisp infrared detail.' },
  { id: 'ngc628', name: 'Phantom Galaxy', catalog: 'NGC 628 / M74', ra: '01h 36m 42s', dec: '+15° 47′', constellation: 'Pisces', type: 'Grand-design Spiral', dist: '32 Mly', potential: 'good', recipeCount: 9, blurb: 'A face-on spiral where MIRI traces delicate filamentary dust webs threading the interarm regions.' },
  { id: 'wr140', name: 'WR 140 Dust Shells', catalog: 'WR 140', ra: '20h 20m 28s', dec: '+43° 51′', constellation: 'Cygnus', type: 'Binary / Dust', dist: '5,600 ly', potential: 'good', recipeCount: 6, blurb: 'Colliding-wind binary producing concentric dust shells — one shell per orbit, expanding outward like clockwork.' },
  { id: 'trappist', name: 'TRAPPIST-1 System', catalog: 'TRAPPIST-1', ra: '23h 06m 30s', dec: '-05° 02′', constellation: 'Aquarius', type: 'Exoplanet System', dist: '40 ly', potential: 'limited', recipeCount: 4, blurb: 'A nearby red dwarf with seven rocky planets. JWST probes atmospheres via transit transmission spectroscopy.' },
  { id: 'ngc7469', name: 'Active Galaxy NGC 7469', catalog: 'NGC 7469', ra: '23h 03m 15s', dec: '+08° 52′', constellation: 'Pegasus', type: 'Seyfert AGN', dist: '220 Mly', potential: 'good', recipeCount: 7, blurb: 'A nearby Seyfert with a starburst ring circling its active nucleus — mid-infrared peels back the obscuring dust.' },
  { id: 'southernring', name: 'Southern Ring Nebula', catalog: 'NGC 3132', ra: '10h 07m 02s', dec: '-40° 26′', constellation: 'Vela', type: 'Planetary Nebula', dist: '2,500 ly', potential: 'great', recipeCount: 11, blurb: 'Concentric shells of gas ejected by a dying star, with a faint white-dwarf companion newly resolved by NIRCam.' },
];

const FILTERS_RGB = [
  { code: 'F770W',  name: 'MIRI 7.7μm',  color: '#ff4d4d', instrument: 'MIRI',   wv: '7.70μm', exp: 1200 },
  { code: 'F444W',  name: 'NIRCam 4.4μm', color: '#3b82f6', instrument: 'NIRCam', wv: '4.44μm', exp: 600 },
  { code: 'F335M',  name: 'NIRCam 3.35μm',color: '#4ecdc4', instrument: 'NIRCam', wv: '3.35μm', exp: 600 },
  { code: 'F187N',  name: 'NIRCam 1.87μm',color: '#a855f7', instrument: 'NIRCam', wv: '1.87μm', exp: 900 },
  { code: 'F200W',  name: 'NIRCam 2.0μm', color: '#f59e0b', instrument: 'NIRCam', wv: '2.00μm', exp: 600 },
  { code: 'F090W',  name: 'NIRCam 0.9μm', color: '#10b981', instrument: 'NIRCam', wv: '0.90μm', exp: 600 },
];

const RECIPES = [
  { id: 'hubble-palette', name: 'Hubble Palette', desc: 'Narrow-band SII/Hα/OIII-style mapping for nebular detail. Emphasizes ionization structure over continuum.',
    pinned: true, recommended: true, filters: ['F770W', 'F444W', 'F335M'], ready: true, obs: 6, processing: '~4 min' },
  { id: 'deep-nircam', name: 'Deep NIRCam', desc: 'Six-filter short-wavelength stack for stellar populations and faint extended emission.',
    pinned: false, recommended: true, filters: ['F090W', 'F200W', 'F444W'], ready: true, obs: 9, processing: '~6 min' },
  { id: 'dust-lanes', name: 'Dust Penetration', desc: 'Mid-IR-heavy weighting to cut through foreground dust and highlight embedded sources.',
    pinned: false, recommended: false, filters: ['F770W', 'F335M', 'F187N'], ready: true, obs: 4, processing: '~3 min' },
  { id: 'paah', name: 'PAH Emission Map', desc: 'Emphasizes polycyclic aromatic hydrocarbon features — ideal for star-forming regions.',
    pinned: false, recommended: false, filters: ['F770W', 'F335M', 'F187N'], ready: false, missing: 1, obs: 3, processing: '~3 min' },
];

const OBSERVATIONS = [
  { id: 'jw02739-c1014_t007', filter: 'F770W', instrument: 'MIRI', exp: 1200, pa: 136.2, date: '2022-08-12' },
  { id: 'jw02739-c1014_t008', filter: 'F444W', instrument: 'NIRCam', exp: 600, pa: 136.2, date: '2022-08-12' },
  { id: 'jw02739-c1014_t009', filter: 'F335M', instrument: 'NIRCam', exp: 600, pa: 136.2, date: '2022-08-12' },
  { id: 'jw02739-c1014_t010', filter: 'F187N', instrument: 'NIRCam', exp: 900, pa: 136.2, date: '2022-08-12' },
  { id: 'jw02739-c1014_t011', filter: 'F200W', instrument: 'NIRCam', exp: 600, pa: 136.2, date: '2022-08-12' },
  { id: 'jw02739-c1014_t012', filter: 'F090W', instrument: 'NIRCam', exp: 600, pa: 136.2, date: '2022-08-12' },
];

const LIBRARY = [
  { fn: 'jw02739-o001_t001_nircam_clear-f444w_i2d.fits', target: 'M16 · Pillars', inst: 'NIRCam', lvl: 3, size: '184.2 MB', date: '2024-03-02' },
  { fn: 'jw02739-o001_t001_miri_f770w_i2d.fits', target: 'M16 · Pillars', inst: 'MIRI', lvl: 3, size: '142.8 MB', date: '2024-03-02' },
  { fn: 'jw02107-o012_t004_nircam_clear-f090w_i2d.fits', target: 'NGC 3132', inst: 'NIRCam', lvl: 2, size: '211.4 MB', date: '2024-02-18' },
  { fn: 'jw01783-o042_t009_miri_f1500w_i2d.fits', target: 'NGC 7469', inst: 'MIRI', lvl: 3, size: '98.3 MB', date: '2024-01-28' },
];

/* ---------- Small icon ---------- */
const Icon = ({ d, size = 16, style }) => (
  <svg className="icn" viewBox="0 0 24 24" style={{ width: size, height: size, ...style }}>
    <path d={d} />
  </svg>
);
const ICONS = {
  search: 'M21 21l-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z',
  back:   'M19 12H5M12 19l-7-7 7-7',
  star:   'M12 3l2.7 6 6.3.6-4.8 4.4 1.4 6.3L12 17l-5.6 3.3 1.4-6.3L3 9.6l6.3-.6z',
  download: 'M12 4v12m0 0l-4-4m4 4l4-4M5 20h14',
  bolt: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  check: 'M20 6L9 17l-5-5',
  copy: 'M8 8v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2m-8 0V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2',
};

/* ---------- Header ---------- */
function AppHeader({ page, go }) {
  const Nav = ({ id, children }) => (
    <a className={'nav-link' + (page.startsWith(id) ? ' active' : '')} onClick={() => go(id)}>{children}</a>
  );
  return (
    <header className="app-header">
      <div className="header-content">
        <div className="header-left">
          <a className="brand" onClick={() => go('discover')} style={{cursor:'pointer'}}>
            <span className="accent">◐</span> Photon <span className="accent">/</span> JWST
          </a>
          <nav className="header-nav">
            <Nav id="discover">Discover</Nav>
            <Nav id="library">Library</Nav>
            <a className="nav-link">Docs</a>
          </nav>
        </div>
        <div className="user-menu">
          <span>A. Chen</span>
          <div className="avatar">AC</div>
        </div>
      </div>
    </header>
  );
}

/* ---------- Discover ---------- */
function DiscoverPage({ go, setTargetId }) {
  const [filter, setFilter] = useState('all');
  const filtered = filter === 'all' ? TARGETS : TARGETS.filter(t => {
    if (filter === 'nebula') return /Nebula|Star-forming/i.test(t.type);
    if (filter === 'galaxy') return /Galaxy|Spiral|Seyfert/i.test(t.type);
    if (filter === 'exoplanet') return /Exoplanet/i.test(t.type);
    if (filter === 'great') return t.potential === 'great';
    return true;
  });
  const open = (id) => { setTargetId(id); go('target'); };

  return (
    <div className="page active">
      <div className="hero">
        <h1>Explore the universe through Webb&rsquo;s eyes.</h1>
        <p>Browse JWST public targets, pick a filter recipe, and export a finished image — no command-line gymnastics.</p>
        <div className="search-wrap">
          <div className="discovery-search">
            <input placeholder="Search by name, catalog ID, or constellation…" defaultValue=""/>
            <button>Search</button>
          </div>
        </div>
      </div>

      <div>
        <div className="section-header" style={{marginBottom: 'var(--space-4)'}}>
          <h2>Featured targets</h2>
          <span className="count">{filtered.length} of {TARGETS.length} targets</span>
        </div>
        <div className="filter-bar" style={{marginBottom: 'var(--space-5)'}}>
          {[['all','All targets'],['great','Best potential'],['nebula','Nebulae'],['galaxy','Galaxies'],['exoplanet','Exoplanets']].map(([id,label]) => (
            <button key={id} className={'s-chip' + (filter===id?' active':'')} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>

        <div className="target-grid">
          {filtered.map(t => (
            <a key={t.id} className="target-card" onClick={() => open(t.id)}>
              <div className="thumb" style={{background: thumbBg(t.id)}}>
                <Icon d={ICONS.star} size={40} />
              </div>
              <div className="body">
                <h3>{t.name}</h3>
                <div className="catalog">{t.catalog}</div>
                <div className="info">
                  <span>{t.type}</span>
                  <span className="dot">·</span>
                  <span>{t.dist}</span>
                </div>
                <span className={'potential potential-' + t.potential}>
                  {t.potential === 'great' && '✦ '}
                  {t.potential === 'great' ? 'Great potential' : t.potential === 'good' ? 'Good potential' : 'Limited data'} · {t.recipeCount} recipes
                </span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function thumbBg(id) {
  const seeds = {
    m16: 'radial-gradient(circle at 30% 50%, #8b5cf6 0, transparent 40%), radial-gradient(circle at 65% 45%, #ff4d4d 0, transparent 35%), radial-gradient(circle at 50% 75%, #f59e0b 0, transparent 25%), #0a0a0c',
    ngc1300: 'radial-gradient(circle at 50% 50%, #4ecdc4 0, transparent 35%), radial-gradient(ellipse at 50% 50%, rgba(74,144,217,0.5) 0, transparent 60%), #0a0a0c',
    carina: 'radial-gradient(circle at 30% 70%, #ff4d4d 0, transparent 50%), radial-gradient(circle at 70% 30%, #a855f7 0, transparent 40%), #0a0a0c',
    ngc628: 'radial-gradient(circle at 50% 50%, rgba(255,200,100,0.6) 0, transparent 30%), radial-gradient(ellipse at 50% 50%, rgba(78,205,196,0.3) 20%, transparent 70%), #0a0a0c',
    wr140: 'radial-gradient(circle at 50% 50%, #f59e0b 0%, rgba(245,158,11,0.3) 10%, transparent 15%), radial-gradient(circle at 50% 50%, transparent 25%, rgba(245,158,11,0.4) 27%, transparent 30%), radial-gradient(circle at 50% 50%, transparent 42%, rgba(245,158,11,0.3) 44%, transparent 47%), #0a0a0c',
    trappist: 'radial-gradient(circle at 50% 50%, #ff4d4d 0, transparent 15%), #0a0a0c',
    ngc7469: 'radial-gradient(circle at 50% 50%, #f59e0b 0, transparent 20%), radial-gradient(circle at 50% 50%, transparent 30%, rgba(139,92,246,0.4) 40%, transparent 55%), #0a0a0c',
    southernring: 'radial-gradient(circle at 50% 50%, #4ecdc4 0, transparent 15%), radial-gradient(circle at 50% 50%, transparent 20%, rgba(239,68,68,0.5) 30%, transparent 45%), #0a0a0c',
  };
  return seeds[id] || '#0a0a0c';
}

/* ---------- Target detail ---------- */
function TargetPage({ targetId, go, setRecipeId }) {
  const t = TARGETS.find(x => x.id === targetId) || TARGETS[0];
  const [obsOpen, setObsOpen] = useState(false);
  const open = (rid) => { setRecipeId(rid); go('recipe'); };

  return (
    <div className="page active">
      <a className="back-link" onClick={() => go('discover')}>
        <Icon d={ICONS.back} /> Back to Discover
      </a>

      <div className="detail-layout">
        <div>
          <div className="hero-image" style={{background: thumbBg(t.id)}}>
            <div className="stars"/>
          </div>
          <div className="detail-meta" style={{marginTop: 'var(--space-4)'}}>
            <div className="meta-item"><span className="k">RA</span><span className="v">{t.ra}</span></div>
            <div className="meta-item"><span className="k">Dec</span><span className="v">{t.dec}</span></div>
            <div className="meta-item"><span className="k">Constellation</span><span className="v" style={{fontFamily:'var(--font-sans)'}}>{t.constellation}</span></div>
          </div>
        </div>

        <div>
          <div className="detail-title">
            <h1>{t.name}</h1>
            <div className="catalog">{t.catalog}</div>
          </div>
          <p className="detail-description">{t.blurb}</p>

          <div className="detail-meta">
            <div className="meta-item"><span className="k">Type</span><span className="v" style={{fontFamily:'var(--font-sans)'}}>{t.type}</span></div>
            <div className="meta-item"><span className="k">Distance</span><span className="v">{t.dist}</span></div>
            <div className="meta-item"><span className="k">Observations</span><span className="v">{OBSERVATIONS.length} · {new Set(OBSERVATIONS.map(o=>o.instrument)).size} instruments</span></div>
          </div>

          <div className="section-header">
            <h2>Filter recipes <span style={{color:'var(--text-muted)', fontWeight:400, fontSize:'var(--text-base)'}}>· {RECIPES.length} available</span></h2>
          </div>

          <div className="recipe-grid" style={{marginTop:'var(--space-4)'}}>
            {RECIPES.map(r => (
              <div key={r.id} className={'recipe-card' + (r.recommended ? ' recommended' : '')}>
                {r.pinned && <span className="pin-badge">📌 PINNED</span>}
                <h4>{r.name}</h4>
                <p className="desc">{r.desc}</p>
                <div className="f-chips">
                  {r.filters.map(code => {
                    const f = FILTERS_RGB.find(x => x.code === code);
                    return <span key={code} className="f-chip"><span className="sw" style={{background: f.color}}/>{code}</span>;
                  })}
                </div>
                <div className="color-bar">
                  {r.filters.map(code => {
                    const f = FILTERS_RGB.find(x => x.code === code);
                    return <div key={code} style={{background: f.color}} />;
                  })}
                </div>
                <div className="recipe-meta">
                  <span>{r.obs} observations</span>
                  <span className="dot">·</span>
                  <span>{r.processing}</span>
                  <span className="dot">·</span>
                  {r.ready
                    ? <span className="ready">✓ Ready to process</span>
                    : <span className="warn">⚠ {r.missing} filter{r.missing>1?'s':''} missing</span>}
                </div>
                <button className="cta" onClick={() => open(r.id)} disabled={!r.ready}>
                  {r.ready ? 'Process this recipe' : 'View details'}
                </button>
              </div>
            ))}
          </div>

          <div style={{marginTop:'var(--space-8)'}}>
            <button className="obs-toggle" onClick={() => setObsOpen(o => !o)}>
              <span>Raw observations · {OBSERVATIONS.length} files available for custom processing</span>
              <span style={{fontFamily:'var(--font-mono)'}}>{obsOpen ? '▾' : '▸'}</span>
            </button>
            {obsOpen && (
              <div className="obs-wrap" style={{marginTop:'var(--space-3)'}}>
                <table className="obs-table">
                  <thead>
                    <tr>
                      <th>Observation ID</th>
                      <th>Filter</th>
                      <th>Instrument</th>
                      <th style={{textAlign:'right'}}>Exposure</th>
                      <th style={{textAlign:'right'}}>PA</th>
                      <th>Date</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {OBSERVATIONS.map(o => (
                      <tr key={o.id}>
                        <td className="obs-id">{o.id}</td>
                        <td><code>{o.filter}</code></td>
                        <td>{o.instrument}</td>
                        <td style={{textAlign:'right', fontFamily:'var(--font-mono)'}}>{o.exp}s</td>
                        <td style={{textAlign:'right', fontFamily:'var(--font-mono)'}}>{o.pa}°</td>
                        <td style={{fontFamily:'var(--font-mono)', color:'var(--text-muted)'}}>{o.date}</td>
                        <td><Icon d={ICONS.download} style={{color:'var(--text-muted)', cursor:'pointer'}} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Recipe / Process page ---------- */
function RecipePage({ recipeId, targetId, go }) {
  const r = RECIPES.find(x => x.id === recipeId) || RECIPES[0];
  const t = TARGETS.find(x => x.id === targetId) || TARGETS[0];

  return (
    <div className="page active">
      <a className="back-link" onClick={() => go('target')}>
        <Icon d={ICONS.back} /> Back to {t.name}
      </a>

      <div className="section-header">
        <h2>{r.name} · {t.name}</h2>
        <span className="count">Recipe ready · {r.obs} observations stacked</span>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1.2fr 1fr', gap:'var(--space-6)'}}>
        <div className="hero-image" style={{aspectRatio:'auto', height: 520, background: thumbBg(t.id)}}>
          <div className="stars"/>
        </div>
        <div style={{display:'flex', flexDirection:'column', gap:'var(--space-4)'}}>
          <div>
            <div style={{color:'var(--text-muted)', fontSize:'var(--text-sm)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom: 'var(--space-2)'}}>Channel mapping</div>
            {r.filters.map((code, i) => {
              const f = FILTERS_RGB.find(x => x.code === code);
              const channel = ['Red', 'Green', 'Blue'][i] || 'Luminance';
              return (
                <div key={code} style={{display:'flex', alignItems:'center', gap:'var(--space-3)', padding:'var(--space-3)', background:'var(--bg-surface)', border:'1px solid var(--border-subtle)', borderRadius:'var(--radius-md)', marginBottom:'var(--space-2)'}}>
                  <div style={{width:32, height:32, borderRadius:'var(--radius-sm)', background: f.color}} />
                  <div style={{flex:1}}>
                    <div style={{fontFamily:'var(--font-mono)', fontSize:'var(--text-sm)'}}>{code}</div>
                    <div style={{color:'var(--text-muted)', fontSize:'var(--text-sm)'}}>{f.name} · {f.wv}</div>
                  </div>
                  <div style={{color:'var(--text-secondary)', fontSize:'var(--text-sm)', fontWeight: 500}}>{channel}</div>
                </div>
              );
            })}
          </div>

          <div style={{display:'flex', gap:'var(--space-3)', flexWrap:'wrap'}}>
            <button className="btn btn-export"><Icon d={ICONS.bolt}/> Process recipe</button>
            <button className="btn btn-outline"><Icon d={ICONS.eye}/> Preview first</button>
            <button className="btn btn-outline"><Icon d={ICONS.copy}/> Duplicate & edit</button>
          </div>

          <div style={{marginTop:'auto', padding:'var(--space-4)', background:'var(--bg-surface)', border:'1px solid var(--border-subtle)', borderRadius:'var(--radius-md)', fontSize:'var(--text-sm)', color:'var(--text-secondary)', lineHeight:1.6}}>
            <strong style={{color:'var(--text-primary)'}}>Estimated processing:</strong> {r.processing}<br/>
            Output: 8192 × 8192 · 16-bit TIFF + calibrated FITS<br/>
            Runs on your quota — no local compute required.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Library page ---------- */
function LibraryPage() {
  const [q, setQ] = useState('');
  const rows = LIBRARY.filter(r => !q || r.fn.includes(q) || r.target.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page active">
      <div className="section-header">
        <h2>Your data library</h2>
        <span className="count">{rows.length} files · 636.7 MB</span>
      </div>

      <div style={{display:'flex', gap:'var(--space-3)', flexWrap:'wrap', alignItems:'center'}}>
        <div className="discovery-search" style={{height:40, flex:1, minWidth: 280, maxWidth: 480}}>
          <input placeholder="Search filenames or targets…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <button className="s-chip active">All</button>
        <button className="s-chip">NIRCam</button>
        <button className="s-chip">MIRI</button>
        <button className="btn btn-primary" style={{marginLeft:'auto'}}><Icon d={ICONS.download}/> Export selection</button>
      </div>

      <div style={{marginTop: 'var(--space-2)'}}>
        {rows.map(r => (
          <div key={r.fn} className="data-card-row">
            <div className="mini" />
            <div className="info">
              <div className="fn">{r.fn}</div>
              <div className="sub">{r.target} · {r.size} · {r.date}</div>
            </div>
            <span className="i-badge" style={{
              color: r.inst === 'NIRCam' ? '#a855f7' : '#ff8844',
              background: r.inst === 'NIRCam' ? 'rgba(168,85,247,0.12)' : 'rgba(255,136,68,0.12)',
              borderColor: r.inst === 'NIRCam' ? 'rgba(168,85,247,0.35)' : 'rgba(255,136,68,0.35)',
            }}>{r.inst}</span>
            <span className="lvl">L{r.lvl}</span>
            <button className="btn btn-outline" style={{height: 32, padding: '0 var(--space-3)', fontSize:'var(--text-sm)'}}><Icon d={ICONS.download}/> Get</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- App shell ---------- */
function App() {
  const [page, setPage] = useState('discover');
  const [targetId, setTargetId] = useState('m16');
  const [recipeId, setRecipeId] = useState('hubble-palette');

  const go = (p) => { setPage(p); window.scrollTo(0, 0); };

  return (
    <>
      <AppHeader page={page} go={go} />
      <main className="app-main">
        {page === 'discover' && <DiscoverPage go={go} setTargetId={setTargetId} />}
        {page === 'target'   && <TargetPage targetId={targetId} go={go} setRecipeId={setRecipeId} />}
        {page === 'recipe'   && <RecipePage recipeId={recipeId} targetId={targetId} go={go} />}
        {page === 'library'  && <LibraryPage />}
      </main>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
