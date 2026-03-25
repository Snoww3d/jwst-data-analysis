#!/usr/bin/env python3
"""
Interactive Recipe Grader with Version History

Run-centric grader: shows the latest walkthrough run as a gallery.
Press C for horizontal side-by-side comparison against older versions.

Usage:
    python3 scripts/recipe-grader.py [--port 8888] [--dir data/recipe-review]

Opens http://localhost:8888 in your browser.
Grades are saved to data/recipe-review/grades.json automatically.
"""

import argparse
import json
import re
import sys
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

DEFAULT_DIR = "data/recipe-review"
DEFAULT_PORT = 8888

# Known preset suffixes to strip from recipe display names
KNOWN_PRESETS = [
    "nasa_press",
    "natural",
    "high_contrast",
    "faint_emission",
    "scientific",
]

VERSION_PATTERN = re.compile(r"^(.+?)(?:\.v(\d{8}(?:[-_]\d+)?))?$")


def parse_image_stem(stem: str) -> tuple[str, str | None, str | None]:
    """Parse an image stem into (recipe_display, preset, version).

    Examples:
        '4-filter_MIRI_nasa_press' → ('4-filter MIRI', 'nasa_press', None)
        '4-filter_MIRI_nasa_press.v20260317' → ('4-filter MIRI', 'nasa_press', '20260317')
    """
    m = VERSION_PATTERN.match(stem)
    base = m.group(1) if m else stem
    version = m.group(2) if m else None

    preset = None
    for p in KNOWN_PRESETS:
        suffix = f"_{p}"
        if base.endswith(suffix):
            preset = p
            base = base[: -len(suffix)]
            break

    recipe = base.replace("_", " ")
    return recipe, preset, version


# ---------------------------------------------------------------------------
# HTML page — run-centric grader with horizontal comparison
# ---------------------------------------------------------------------------

HTML_PAGE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Recipe Grader — JWST Composites</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0f; color: #e0e0e0; min-height: 100vh; }

  .header { display: flex; align-items: center; justify-content: space-between; padding: 10px 20px; background: #12121a; border-bottom: 1px solid #2a2a3a; position: sticky; top: 0; z-index: 100; }
  .header h1 { font-size: 16px; font-weight: 600; color: #7eb8ff; }
  .header-center { display: flex; align-items: center; gap: 12px; }
  .run-select { background: #1a1a2a; border: 1px solid #3a3a4a; border-radius: 6px; color: #ccc; padding: 4px 8px; font-size: 13px; cursor: pointer; }
  .run-select:focus { outline: none; border-color: #4a9eff; }
  .header-right { display: flex; align-items: center; gap: 12px; font-size: 13px; color: #888; }
  .progress-bar { width: 140px; height: 5px; background: #2a2a3a; border-radius: 3px; overflow: hidden; }
  .progress-fill { height: 100%; background: #4a9eff; border-radius: 3px; transition: width 0.3s; }

  .container { display: flex; height: calc(100vh - 49px); }

  /* Sidebar */
  .sidebar { width: 260px; background: #12121a; border-right: 1px solid #2a2a3a; display: flex; flex-direction: column; flex-shrink: 0; }
  .filters { padding: 10px; border-bottom: 1px solid #2a2a3a; display: flex; gap: 5px; flex-wrap: wrap; }
  .filter-btn { padding: 3px 9px; border: 1px solid #3a3a4a; border-radius: 10px; background: transparent; color: #999; font-size: 11px; cursor: pointer; }
  .filter-btn:hover { border-color: #5a5a7a; color: #ddd; }
  .filter-btn.active { background: #4a9eff22; border-color: #4a9eff; color: #7eb8ff; }

  .image-list { flex: 1; overflow-y: auto; padding: 6px; }

  /* Tree — target level */
  .tree-target { margin-bottom: 2px; }
  .tree-target-header { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 5px; cursor: pointer; font-size: 12px; user-select: none; }
  .tree-target-header:hover { background: #1a1a2a; }
  .tree-chevron { font-size: 9px; color: #555; width: 12px; text-align: center; flex-shrink: 0; transition: transform 0.15s; }
  .tree-target.collapsed .tree-chevron { transform: rotate(-90deg); }
  .tree-target-name { color: #7eb8ff; font-weight: 600; font-size: 11px; }
  .tree-target-summary { margin-left: auto; display: flex; align-items: center; gap: 4px; font-size: 10px; }
  .tree-target-avg { padding: 1px 5px; border-radius: 8px; font-size: 9px; font-weight: 600; }
  .tree-target-count { color: #444; }
  .tree-target.collapsed .tree-recipes { display: none; }

  /* Tree — recipe level */
  .tree-recipe { margin-left: 12px; }
  .tree-recipe-header { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; user-select: none; }
  .tree-recipe-header:hover { background: #1a1a2a; }
  .tree-recipe.collapsed .tree-recipe-chevron { transform: rotate(-90deg); }
  .tree-recipe-chevron { font-size: 8px; color: #444; width: 10px; text-align: center; flex-shrink: 0; transition: transform 0.15s; }
  .tree-recipe-name { color: #bbb; }
  .tree-recipe-count { margin-left: auto; font-size: 9px; color: #444; }
  .tree-recipe.collapsed .tree-items { display: none; }

  /* Tree — leaf items */
  .tree-items { margin-left: 10px; }
  .image-item { padding: 5px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; margin-bottom: 1px; display: flex; align-items: center; gap: 6px; margin-left: 12px; }
  .image-item:hover { background: #1a1a2a; }
  .image-item.active { background: #1a2a3a; border-left: 2px solid #4a9eff; }
  .grade-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .grade-dot.ungraded { background: #444; }
  .grade-dot.grade-1 { background: #ff4444; }
  .grade-dot.grade-2 { background: #ff8844; }
  .grade-dot.grade-3 { background: #ffcc44; }
  .grade-dot.grade-4 { background: #88cc44; }
  .grade-dot.grade-5 { background: #44cc88; }
  .item-text { color: #999; }
  .grade-delta { font-size: 10px; font-weight: 700; margin-left: auto; }
  .grade-delta.up { color: #44cc88; }
  .grade-delta.down { color: #ff4444; }
  .grade-delta.same { color: #666; }
  .prev-grade { font-size: 10px; color: #555; margin-left: auto; }

  /* Main */
  .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

  /* Single image viewer */
  .viewer { flex: 1; display: flex; align-items: center; justify-content: center; padding: 12px; background: #080810; position: relative; overflow: hidden; }
  .viewer img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px; }
  .viewer .empty { color: #555; font-size: 15px; }

  .image-label { position: absolute; top: 10px; left: 10px; background: #000a; padding: 6px 12px; border-radius: 5px; font-size: 13px; z-index: 5; }
  .image-label .t { color: #7eb8ff; font-weight: 600; }
  .image-label .r { color: #999; margin-left: 6px; }
  .image-label .meta { color: #555; margin-left: 8px; font-size: 11px; }
  .image-label .prev-info { display: block; margin-top: 3px; font-size: 11px; color: #666; }

  /* Compare mode — horizontal split */
  .viewer.compare { display: flex; gap: 0; padding: 0; }
  .compare-pane { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 12px; position: relative; min-width: 0; }
  .compare-pane img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px; }
  .compare-divider { width: 2px; background: #2a2a3a; flex-shrink: 0; }
  .compare-pane-label { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); background: #000c; padding: 5px 14px; border-radius: 10px; font-size: 12px; white-space: nowrap; }
  .compare-hint { position: absolute; top: 10px; right: 10px; background: #000a; padding: 5px 10px; border-radius: 5px; font-size: 11px; color: #666; z-index: 5; }

  /* Grading panel */
  .grading { padding: 12px 20px; background: #12121a; border-top: 1px solid #2a2a3a; display: flex; align-items: flex-start; gap: 20px; }
  .grade-section { display: flex; flex-direction: column; gap: 6px; }
  .grade-section label { font-size: 11px; color: #777; text-transform: uppercase; letter-spacing: 0.5px; }
  .stars { display: flex; gap: 3px; }
  .star { width: 34px; height: 34px; border: 2px solid #3a3a4a; border-radius: 5px; background: transparent; color: #555; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .star:hover { border-color: #ffcc44; color: #ffcc44; }
  .star.active { background: #ffcc4422; border-color: #ffcc44; color: #ffcc44; }
  .tags { display: flex; gap: 5px; flex-wrap: wrap; }
  .tag { padding: 4px 10px; border: 1px solid #3a3a4a; border-radius: 12px; background: transparent; color: #999; font-size: 11px; cursor: pointer; }
  .tag:hover { border-color: #5a5a7a; color: #ddd; }
  .tag.active { background: #4a9eff22; border-color: #4a9eff; color: #7eb8ff; }
  .tag.negative.active { background: #ff444422; border-color: #ff6666; color: #ff8888; }
  .notes-input { flex: 1; background: #1a1a2a; border: 1px solid #3a3a4a; border-radius: 5px; color: #ddd; padding: 7px 10px; font-size: 12px; font-family: inherit; resize: none; height: 54px; }
  .notes-input:focus { outline: none; border-color: #4a9eff; }
  .nav-buttons { display: flex; gap: 6px; align-self: center; }
  .nav-btn { padding: 7px 14px; border: 1px solid #3a3a4a; border-radius: 5px; background: transparent; color: #bbb; font-size: 12px; cursor: pointer; }
  .nav-btn:hover { background: #1a1a2a; }
  .nav-btn.primary { background: #4a9eff22; border-color: #4a9eff; color: #7eb8ff; }
  kbd { display: inline-block; padding: 1px 4px; font-size: 10px; background: #2a2a3a; border-radius: 2px; color: #777; margin-left: 3px; }
</style>
</head>
<body>
<div class="header">
  <h1>Recipe Grader</h1>
  <div class="header-center">
    <span style="color:#666;font-size:12px">Run:</span>
    <select class="run-select" id="run-select" onchange="switchRun(this.value)"></select>
    <span style="color:#555;font-size:11px" id="compare-status"></span>
  </div>
  <div class="header-right">
    <span id="progress-text">0/0</span>
    <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
    <button class="nav-btn" onclick="exportCSV()" style="padding:4px 10px">CSV</button>
  </div>
</div>

<div class="container">
  <div class="sidebar">
    <div class="filters">
      <button class="filter-btn active" data-filter="all" onclick="setFilter('all')">All</button>
      <button class="filter-btn" data-filter="ungraded" onclick="setFilter('ungraded')">Ungraded <kbd>U</kbd></button>
      <button class="filter-btn" data-filter="1" onclick="setFilter('1')">1</button>
      <button class="filter-btn" data-filter="2" onclick="setFilter('2')">2</button>
      <button class="filter-btn" data-filter="3" onclick="setFilter('3')">3</button>
      <button class="filter-btn" data-filter="4" onclick="setFilter('4')">4</button>
      <button class="filter-btn" data-filter="5" onclick="setFilter('5')">5</button>
    </div>
    <div class="image-list" id="image-list"></div>
  </div>

  <div class="main">
    <div class="viewer" id="viewer">
      <div class="empty">Select an image from the sidebar<br><span style="font-size:12px;color:#444">1-5 grade &middot; A/D navigate &middot; C compare &middot; U ungraded</span></div>
    </div>
    <div class="grading" id="grading" style="display:none">
      <div class="grade-section">
        <label>Grade <kbd>1-5</kbd></label>
        <div class="stars" id="stars"></div>
      </div>
      <div class="grade-section">
        <label>Issues</label>
        <div class="tags" id="tags"></div>
      </div>
      <div class="grade-section" style="flex:1">
        <label>Notes</label>
        <textarea class="notes-input" id="notes" placeholder="What would improve this?"></textarea>
      </div>
      <div class="nav-buttons">
        <button class="nav-btn" onclick="toggleCompare()" id="compare-btn">Compare <kbd>C</kbd></button>
        <button class="nav-btn" onclick="navigate(-1)">Prev <kbd>A</kbd></button>
        <button class="nav-btn primary" onclick="navigate(1)">Next <kbd>D</kbd></button>
      </div>
    </div>
  </div>
</div>

<script>
const TAGS = [
  { id: 'too_dark', label: 'Too Dark', neg: true },
  { id: 'too_bright', label: 'Too Bright', neg: true },
  { id: 'wrong_colors', label: 'Wrong Colors', neg: true },
  { id: 'noisy', label: 'Noisy', neg: true },
  { id: 'low_detail', label: 'Low Detail', neg: true },
  { id: 'artifacts', label: 'Artifacts', neg: true },
  { id: 'bad_stretch', label: 'Bad Stretch', neg: true },
  { id: 'good_structure', label: 'Good Structure', neg: false },
  { id: 'good_colors', label: 'Good Colors', neg: false },
  { id: 'publication_ready', label: 'Publication Ready', neg: false },
];

let allImages = [], grades = {}, meta = {};
let runs = [];           // sorted run IDs (null = baseline)
let activeRun = null;    // currently viewed run
let runImages = [];      // images in the active run
let filteredImages = []; // after grade filter
let currentIndex = -1;
let currentFilter = 'all';
let compareMode = false;
let versionGroups = {};  // "target/baseName" → sorted array of images
let saveTimeout = null;
let collapsedTargets = new Set();
let collapsedRecipes = new Set();

function toggleTarget(name) {
  if (collapsedTargets.has(name)) collapsedTargets.delete(name);
  else collapsedTargets.add(name);
  renderList();
}

function toggleRecipe(key) {
  if (collapsedRecipes.has(key)) collapsedRecipes.delete(key);
  else collapsedRecipes.add(key);
  renderList();
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function fmtVer(v) { return v ? v.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : 'Baseline'; }
function fmtTime(s) { return s == null ? '' : s < 10 ? s.toFixed(1) + 's' : Math.round(s) + 's'; }
function imgKey(img) { return img.target + '/' + img.filename; }
function grpKey(img) { return img.target + '/' + img.baseName; }
function getGrade(img) { return grades[imgKey(img)] || {}; }
function getMeta(img) { return meta[imgKey(img)] || {}; }

function getPrev(img) {
  const grp = versionGroups[grpKey(img)];
  if (!grp || grp.length <= 1) return null;
  const idx = grp.findIndex(v => imgKey(v) === imgKey(img));
  return idx > 0 ? grp[idx - 1] : null;
}

function buildGroups() {
  versionGroups = {};
  for (const img of allImages) {
    const k = grpKey(img);
    if (!versionGroups[k]) versionGroups[k] = [];
    versionGroups[k].push(img);
  }
  for (const k of Object.keys(versionGroups)) {
    versionGroups[k].sort((a, b) => {
      if (!a.version) return -1;
      if (!b.version) return 1;
      return a.version.localeCompare(b.version);
    });
  }
}

function detectRuns() {
  const s = new Set(allImages.map(i => i.version));
  runs = [...s].sort((a, b) => {
    if (!a) return -1;
    if (!b) return 1;
    return a.localeCompare(b);
  });
  // Default to latest run
  activeRun = runs.length > 0 ? runs[runs.length - 1] : null;
}

function buildRunSelect() {
  const sel = document.getElementById('run-select');
  sel.innerHTML = '';
  for (const r of runs) {
    const opt = document.createElement('option');
    opt.value = r || '__baseline__';
    opt.textContent = fmtVer(r) + ' (' + allImages.filter(i => i.version === r).length + ')';
    if (r === activeRun) opt.selected = true;
    sel.appendChild(opt);
  }
}

function switchRun(val) {
  activeRun = val === '__baseline__' ? null : val;
  runImages = allImages.filter(i => i.version === activeRun);
  currentIndex = -1;
  compareMode = false;
  applyFilter();
  if (filteredImages.length > 0) selectImage(0);
  updateProgress();
}

async function init() {
  const [imgR, grR, metR] = await Promise.all([
    fetch('/api/images').then(r => r.json()),
    fetch('/api/grades').then(r => r.json()),
    fetch('/api/meta').then(r => r.json()),
  ]);
  allImages = imgR; grades = grR; meta = metR;
  buildGroups();
  detectRuns();
  buildRunSelect();
  runImages = allImages.filter(i => i.version === activeRun);

  // Build stars
  const starsEl = document.getElementById('stars');
  for (let i = 1; i <= 5; i++) {
    const btn = document.createElement('button');
    btn.className = 'star'; btn.textContent = i;
    btn.onclick = () => setGrade(i);
    starsEl.appendChild(btn);
  }
  // Build tags
  const tagsEl = document.getElementById('tags');
  TAGS.forEach(tag => {
    const btn = document.createElement('button');
    btn.className = 'tag' + (tag.neg ? ' negative' : '');
    btn.textContent = tag.label; btn.dataset.tagId = tag.id;
    btn.onclick = () => toggleTag(tag.id);
    tagsEl.appendChild(btn);
  });

  applyFilter();
  if (filteredImages.length > 0) selectImage(0);
  updateProgress();
}

function applyFilter() {
  if (currentFilter === 'all') filteredImages = [...runImages];
  else if (currentFilter === 'ungraded') filteredImages = runImages.filter(i => !getGrade(i).grade);
  else { const g = parseInt(currentFilter); filteredImages = runImages.filter(i => getGrade(i).grade === g); }
  renderList();
}

function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
  applyFilter();
  if (filteredImages.length > 0) selectImage(0);
  else { currentIndex = -1; renderViewer(); }
}

function gradeColor(avg) {
  if (avg >= 4.5) return '#44cc88';
  if (avg >= 3.5) return '#88cc44';
  if (avg >= 2.5) return '#ffcc44';
  if (avg >= 1.5) return '#ff8844';
  return '#ff4444';
}

function deltaHtml(img) {
  const g = getGrade(img);
  const prev = getPrev(img);
  const prevG = prev ? getGrade(prev).grade : null;
  if (prevG && g.grade) {
    const d = g.grade - prevG;
    if (d > 0) return '<span class="grade-delta up">+' + d + '</span>';
    if (d < 0) return '<span class="grade-delta down">' + d + '</span>';
    return '<span class="grade-delta same">=</span>';
  }
  if (prevG && !g.grade) return '<span class="prev-grade">was ' + prevG + '</span>';
  return '';
}

function renderList() {
  const list = document.getElementById('image-list');
  list.innerHTML = '';

  // Group: target → recipe → images
  const targetMap = new Map();
  filteredImages.forEach((img, i) => {
    if (!targetMap.has(img.target)) targetMap.set(img.target, new Map());
    const recipeMap = targetMap.get(img.target);
    if (!recipeMap.has(img.recipe)) recipeMap.set(img.recipe, []);
    recipeMap.get(img.recipe).push({ img, idx: i });
  });

  for (const [target, recipeMap] of targetMap) {
    // Collect all images under this target for summary stats
    const allTargetImgs = [...recipeMap.values()].flat();
    const graded = allTargetImgs.filter(e => getGrade(e.img).grade);
    const avg = graded.length > 0 ? graded.reduce((s, e) => s + getGrade(e.img).grade, 0) / graded.length : 0;

    const targetEl = document.createElement('div');
    targetEl.className = 'tree-target' + (collapsedTargets.has(target) ? ' collapsed' : '');

    const header = document.createElement('div');
    header.className = 'tree-target-header';
    header.onclick = () => toggleTarget(target);
    const avgBadge = avg > 0
      ? '<span class="tree-target-avg" style="background:' + gradeColor(avg) + '22;color:' + gradeColor(avg) + '">' + avg.toFixed(1) + '</span>'
      : '';
    header.innerHTML =
      '<span class="tree-chevron">\u25BC</span>' +
      '<span class="tree-target-name">' + esc(target) + '</span>' +
      '<span class="tree-target-summary">' + avgBadge +
        '<span class="tree-target-count">' + graded.length + '/' + allTargetImgs.length + '</span>' +
      '</span>';
    targetEl.appendChild(header);

    const recipesEl = document.createElement('div');
    recipesEl.className = 'tree-recipes';

    for (const [recipe, entries] of recipeMap) {
      const recipeKey = target + '/' + recipe;

      // If only one image under this recipe, render it directly (no sub-group)
      if (entries.length === 1) {
        const { img, idx } = entries[0];
        const g = getGrade(img);
        const item = document.createElement('div');
        item.className = 'image-item' + (idx === currentIndex ? ' active' : '') + ' tree-recipe';
        item.innerHTML =
          '<span class="grade-dot ' + (g.grade ? 'grade-' + g.grade : 'ungraded') + '"></span>' +
          '<span class="item-text">' + esc(recipe) + (img.preset ? ' <span style="color:#555">' + esc(img.preset) + '</span>' : '') + '</span>' +
          deltaHtml(img);
        item.onclick = () => selectImage(idx);
        recipesEl.appendChild(item);
        continue;
      }

      // Multiple images: collapsible recipe group
      const recipeEl = document.createElement('div');
      recipeEl.className = 'tree-recipe' + (collapsedRecipes.has(recipeKey) ? ' collapsed' : '');

      const rHeader = document.createElement('div');
      rHeader.className = 'tree-recipe-header';
      rHeader.onclick = () => toggleRecipe(recipeKey);
      rHeader.innerHTML =
        '<span class="tree-recipe-chevron">\u25BC</span>' +
        '<span class="tree-recipe-name">' + esc(recipe) + '</span>' +
        '<span class="tree-recipe-count">' + entries.length + '</span>';
      recipeEl.appendChild(rHeader);

      const itemsEl = document.createElement('div');
      itemsEl.className = 'tree-items';

      for (const { img, idx } of entries) {
        const g = getGrade(img);
        const item = document.createElement('div');
        item.className = 'image-item' + (idx === currentIndex ? ' active' : '');
        const label = img.preset ? esc(img.preset) : (img.version ? fmtVer(img.version) : esc(img.filename));
        item.innerHTML =
          '<span class="grade-dot ' + (g.grade ? 'grade-' + g.grade : 'ungraded') + '"></span>' +
          '<span class="item-text">' + label + '</span>' +
          deltaHtml(img);
        item.onclick = () => selectImage(idx);
        itemsEl.appendChild(item);
      }

      recipeEl.appendChild(itemsEl);
      recipesEl.appendChild(recipeEl);
    }

    targetEl.appendChild(recipesEl);
    list.appendChild(targetEl);
  }
}

function selectImage(idx) {
  if (idx < 0 || idx >= filteredImages.length) return;
  currentIndex = idx;
  renderViewer();
  document.getElementById('grading').style.display = 'flex';
  updateGradingUI();
  document.querySelectorAll('.image-item').forEach((el, i) => el.classList.toggle('active', i === currentIndex));
  const activeEl = document.querySelector('.image-item.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  // Update compare button state
  const prev = getPrev(filteredImages[currentIndex]);
  const btn = document.getElementById('compare-btn');
  btn.style.opacity = prev ? '1' : '0.4';
  document.getElementById('compare-status').textContent = compareMode ? 'Comparing' : '';
}

function renderViewer() {
  const viewer = document.getElementById('viewer');
  if (currentIndex < 0 || currentIndex >= filteredImages.length) {
    viewer.className = 'viewer';
    viewer.innerHTML = '<div class="empty">No images to show</div>';
    return;
  }
  const img = filteredImages[currentIndex];
  const g = getGrade(img);
  const m = getMeta(img);
  const prev = getPrev(img);
  const prevG = prev ? getGrade(prev) : null;

  if (compareMode && prev) {
    const pm = getMeta(prev);
    viewer.className = 'viewer compare';
    viewer.innerHTML =
      '<div class="compare-hint">' + (currentIndex + 1) + '/' + filteredImages.length + ' &middot; <kbd>C</kbd> exit</div>' +
      '<div class="compare-pane">' +
        '<img src="/images/' + prev.target + '/' + prev.filename + '" alt="Previous">' +
        '<div class="compare-pane-label">' + fmtVer(prev.version) +
          (prevG && prevG.grade ? ' &mdash; ' + prevG.grade + '/5' : '') +
          (pm.time_s ? ' &middot; ' + fmtTime(pm.time_s) : '') + '</div>' +
      '</div>' +
      '<div class="compare-divider"></div>' +
      '<div class="compare-pane">' +
        '<img src="/images/' + img.target + '/' + img.filename + '" alt="Current">' +
        '<div class="compare-pane-label" style="color:#7eb8ff">' + fmtVer(img.version) +
          (g.grade ? ' &mdash; ' + g.grade + '/5' : ' &mdash; ungraded') +
          (m.time_s ? ' &middot; ' + fmtTime(m.time_s) : '') + '</div>' +
      '</div>';
  } else {
    compareMode = false;
    document.getElementById('compare-status').textContent = '';
    let prevInfo = '';
    if (prev && prevG) {
      prevInfo = '<span class="prev-info">Previous (' + fmtVer(prev.version) + '): ' +
        (prevG.grade ? prevG.grade + '/5' : 'ungraded') +
        (prevG.tags && prevG.tags.length ? ' &middot; ' + prevG.tags.join(', ') : '') + '</span>';
    }
    viewer.className = 'viewer';
    viewer.innerHTML =
      '<div class="image-label">' +
        '<span class="t">' + esc(img.target) + '</span>' +
        '<span class="r">' + esc(img.recipe) + '</span>' +
        '<span class="meta">' + (currentIndex + 1) + '/' + filteredImages.length +
          (m.time_s ? ' &middot; ' + fmtTime(m.time_s) : '') + '</span>' +
        prevInfo +
      '</div>' +
      '<img src="/images/' + img.target + '/' + img.filename + '" alt="' + esc(img.recipe) + '">';
  }
}

function toggleCompare() {
  const img = filteredImages[currentIndex];
  if (!img) return;
  if (!getPrev(img)) return;
  compareMode = !compareMode;
  document.getElementById('compare-status').textContent = compareMode ? 'Comparing' : '';
  renderViewer();
}

function updateGradingUI() {
  const img = filteredImages[currentIndex];
  if (!img) return;
  const g = getGrade(img);
  document.querySelectorAll('.star').forEach((b, i) => b.classList.toggle('active', g.grade && (i + 1) <= g.grade));
  document.querySelectorAll('.tag').forEach(b => b.classList.toggle('active', (g.tags || []).includes(b.dataset.tagId)));
  document.getElementById('notes').value = g.notes || '';
}

function setGrade(grade) {
  if (currentIndex < 0) return;
  const img = filteredImages[currentIndex];
  const key = imgKey(img);
  if (!grades[key]) grades[key] = {};
  grades[key].grade = grade;
  saveGrades();
  renderList();
  updateGradingUI();
  renderViewer();
  updateProgress();
}

function toggleTag(tagId) {
  if (currentIndex < 0) return;
  const key = imgKey(filteredImages[currentIndex]);
  if (!grades[key]) grades[key] = {};
  if (!grades[key].tags) grades[key].tags = [];
  const idx = grades[key].tags.indexOf(tagId);
  if (idx >= 0) grades[key].tags.splice(idx, 1);
  else grades[key].tags.push(tagId);
  saveGrades();
  updateGradingUI();
}

function navigate(d) { selectImage(currentIndex + d); }

function updateProgress() {
  const graded = runImages.filter(i => getGrade(i).grade).length;
  const total = runImages.length;
  const pct = total > 0 ? (graded / total * 100) : 0;
  document.getElementById('progress-text').textContent = graded + '/' + total + ' graded';
  document.getElementById('progress-fill').style.width = pct + '%';
}

// Auto-save notes
document.getElementById('notes').addEventListener('input', e => {
  if (currentIndex < 0) return;
  const key = imgKey(filteredImages[currentIndex]);
  if (!grades[key]) grades[key] = {};
  grades[key].notes = e.target.value;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveGrades, 500);
});

// Keyboard
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA') { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.key >= '1' && e.key <= '5') { setGrade(parseInt(e.key)); setTimeout(() => navigate(1), 120); }
  if (e.key === 'd' || e.key === 'ArrowRight') navigate(1);
  if (e.key === 'a' || e.key === 'ArrowLeft') navigate(-1);
  if (e.key === 'c') toggleCompare();
  if (e.key === 'u') setFilter('ungraded');
  if (e.key === '0') setFilter('all');
});

async function saveGrades() {
  await fetch('/api/grades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(grades) });
}

function exportCSV() {
  const rows = [['Target', 'Recipe', 'Version', 'Grade', 'PrevGrade', 'Delta', 'Tags', 'Notes', 'GenTime_s', 'Size_KB']];
  runImages.forEach(img => {
    const g = getGrade(img);
    const m = getMeta(img);
    const prev = getPrev(img);
    const pg = prev ? getGrade(prev).grade : '';
    const delta = g.grade && pg ? g.grade - pg : '';
    rows.push([img.target, img.recipe, img.version || 'baseline', g.grade || '', pg, delta,
      (g.tags || []).join('; '), (g.notes || '').replace(/"/g, '""'), m.time_s || '', m.size_kb || '']);
  });
  const csv = rows.map(r => r.map(c => '"' + c + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'recipe-grades-' + (activeRun || 'baseline') + '.csv'; a.click();
}

init();
</script>
</body>
</html>
"""


class GraderHandler(SimpleHTTPRequestHandler):
    """HTTP handler for the grader UI, image serving, and grade persistence."""

    image_dir: Path
    grades_file: Path

    def log_message(self, fmt, *args):
        """Suppress default access logging."""
        pass

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path in ("/", ""):
            self._serve_html()
        elif parsed.path == "/api/images":
            self._serve_image_list()
        elif parsed.path == "/api/grades":
            self._serve_grades()
        elif parsed.path == "/api/meta":
            self._serve_meta()
        elif parsed.path.startswith("/images/"):
            self._serve_image(parsed.path[8:])  # strip /images/
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == "/api/grades":
            self._save_grades()
        else:
            self.send_error(404)

    def _serve_html(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(HTML_PAGE.encode())

    def _serve_image_list(self):
        """Scan image directory and return list with version metadata."""
        result = []
        image_dir = self.__class__.image_dir
        if image_dir.exists():
            for target_dir in sorted(image_dir.iterdir()):
                if not target_dir.is_dir():
                    continue
                target = target_dir.name
                for img_file in sorted(target_dir.glob("*.png")):
                    recipe, preset, version = parse_image_stem(img_file.stem)
                    # baseName = stem without version suffix (for grouping)
                    base = img_file.stem
                    if version:
                        base = base[: -(len(version) + 2)]  # strip .vYYYYMMDD
                    result.append(
                        {
                            "target": target,
                            "recipe": recipe,
                            "filename": img_file.name,
                            "baseName": base,
                            "version": version,
                            "preset": preset,
                        }
                    )

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

    def _serve_grades(self):
        grades_file = self.__class__.grades_file
        grades = {}
        if grades_file.exists():
            grades = json.loads(grades_file.read_text())
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(grades).encode())

    def _serve_meta(self):
        """Serve walkthrough metadata (generation times, sizes)."""
        meta_file = self.__class__.image_dir / "meta.json"
        meta = {}
        if meta_file.exists():
            try:
                meta = json.loads(meta_file.read_text())
            except json.JSONDecodeError:
                pass
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(meta).encode())

    def _save_grades(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)
        grades = json.loads(body)
        grades_file = self.__class__.grades_file
        grades_file.write_text(json.dumps(grades, indent=2))

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def _serve_image(self, rel_path: str):
        image_dir = self.__class__.image_dir
        file_path = image_dir / rel_path
        # Security: ensure path doesn't escape image directory
        try:
            file_path.resolve().relative_to(image_dir.resolve())
        except ValueError:
            self.send_error(403)
            return

        if not file_path.exists():
            self.send_error(404)
            return

        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Cache-Control", "max-age=3600")
        self.end_headers()
        self.wfile.write(file_path.read_bytes())


def main():
    parser = argparse.ArgumentParser(description="Interactive recipe grading UI")
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Port (default: {DEFAULT_PORT})",
    )
    parser.add_argument(
        "--dir", default=DEFAULT_DIR, help=f"Image directory (default: {DEFAULT_DIR})"
    )
    parser.add_argument(
        "--no-open", action="store_true", help="Don't auto-open browser"
    )
    args = parser.parse_args()

    image_dir = Path(args.dir).resolve()
    if not image_dir.exists():
        print(f"Image directory not found: {image_dir}")
        sys.exit(1)

    image_count = len(list(image_dir.rglob("*.png")))
    if image_count == 0:
        print(f"No PNG images found in {image_dir}")
        sys.exit(1)

    GraderHandler.image_dir = image_dir
    GraderHandler.grades_file = image_dir / "grades.json"

    server = HTTPServer(("0.0.0.0", args.port), GraderHandler)
    url = f"http://localhost:{args.port}"

    print("Recipe Grader")
    print(f"  Images: {image_count} in {image_dir}")
    print(f"  Grades: {GraderHandler.grades_file}")
    print(f"  URL:    {url}")
    print("\nKeyboard: 1-5 grade, A/D navigate, C compare, U ungraded, 0 all")
    print("Press Ctrl+C to stop.\n")

    if not args.no_open:
        webbrowser.open(url)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
