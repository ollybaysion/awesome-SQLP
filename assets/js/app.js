/* ===== SQLP 학습 대시보드 - app.js ===== */

// ── State ──────────────────────────────────────────────
const state = {
  manifest: null,
  currentHash: null,
  progress: {},       // { "subject-id/topic-id": true }
  allTopics: [],      // flat list for prev/next navigation
};

// ── Init ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  loadProgress();
  await loadManifest();
  setupSearch();
  setupMenu();
  window.addEventListener('hashchange', onHashChange);
  onHashChange();
});

// ── Manifest ───────────────────────────────────────────
async function loadManifest() {
  try {
    const res = await fetch('manifest.json?v=' + Date.now());
    state.manifest = await res.json();
    buildFlatTopicList();
    renderSidebar();
    renderHomeCards();
  } catch (e) {
    console.error('manifest.json 로드 실패:', e);
    document.getElementById('homeScreen').innerHTML =
      '<p style="color:red;padding:40px">manifest.json을 불러올 수 없습니다.</p>';
  }
}

// ── Flat topic list for prev/next ─────────────────────
function buildFlatTopicList() {
  state.allTopics = [];
  // exam topics (fixed)
  state.allTopics.push({ subjectId: 'exam', topicId: 'overview', hash: 'exam/overview' });
  state.allTopics.push({ subjectId: 'exam', topicId: 'grading',  hash: 'exam/grading' });

  for (const subject of state.manifest.subjects) {
    for (const topic of subject.topics) {
      state.allTopics.push({
        subjectId: subject.id,
        topicId: topic.id,
        hash: `${subject.id}/${topic.id}`,
      });
    }
  }
}

// ── Sidebar ────────────────────────────────────────────
function renderSidebar() {
  const container = document.getElementById('subjectNav');
  container.innerHTML = '';

  for (const subject of state.manifest.subjects) {
    const completed = subject.topics.filter(t =>
      state.progress[`${subject.id}/${t.id}`]
    ).length;
    const total = subject.topics.length;

    const section = document.createElement('div');
    section.className = 'nav-section';
    section.dataset.section = subject.id;

    section.innerHTML = `
      <button class="nav-section-header" onclick="toggleSection('${subject.id}')">
        <span class="subject-dot" style="background:${subject.color}"></span>
        <span class="section-title">${subject.title}</span>
        <span class="section-progress">${completed}/${total}</span>
        <svg class="chevron" width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/>
        </svg>
      </button>
      <div class="nav-section-body" id="section-body-${subject.id}">
        ${subject.topics.map(topic => renderNavItem(subject.id, topic)).join('')}
      </div>
    `;

    container.appendChild(section);
  }
}

function renderNavItem(subjectId, topic) {
  const hash = `${subjectId}/${topic.id}`;
  const done = state.progress[hash];
  return `
    <a class="nav-item${done ? ' completed' : ''}"
       href="#${hash}" data-hash="${hash}"
       title="${topic.title}">
      <span class="nav-item-check">${done ? '✅' : '⬜'}</span>
      <span class="nav-item-title">${topic.title}</span>
    </a>
  `;
}

// ── Section toggle ──────────────────────────────────────
function toggleSection(sectionId) {
  const section = document.querySelector(`.nav-section[data-section="${sectionId}"]`);
  if (section) section.classList.toggle('collapsed');
}

// ── Home cards ─────────────────────────────────────────
function renderHomeCards() {
  const statsEl = document.getElementById('homeStats');
  const cardsEl = document.getElementById('homeCards');

  let totalTopics = 2; // exam overview + grading
  let totalDone = (state.progress['exam/overview'] ? 1 : 0) + (state.progress['exam/grading'] ? 1 : 0);

  const cards = state.manifest.subjects.map(subject => {
    const done = subject.topics.filter(t => state.progress[`${subject.id}/${t.id}`]).length;
    const total = subject.topics.length;
    totalTopics += total;
    totalDone += done;
    const pct = total ? Math.round(done / total * 100) : 0;
    return `
      <div class="subject-card" style="--accent:${subject.color}"
           onclick="window.location.hash='${subject.id}/${subject.topics[0]?.id || ''}'">
        <div class="subject-card-title">${subject.title}</div>
        <div class="subject-card-count">${done} / ${total} 완료</div>
        <div class="subject-card-bar">
          <div class="subject-card-fill" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  });

  cardsEl.innerHTML = cards.join('');

  const globalPct = totalTopics ? Math.round(totalDone / totalTopics * 100) : 0;
  statsEl.innerHTML = `
    <div class="stat-card"><div class="stat-value">${totalTopics}</div><div class="stat-label">전체 토픽</div></div>
    <div class="stat-card"><div class="stat-value">${totalDone}</div><div class="stat-label">완료</div></div>
    <div class="stat-card"><div class="stat-value">${totalTopics - totalDone}</div><div class="stat-label">남은 토픽</div></div>
    <div class="stat-card"><div class="stat-value">${globalPct}%</div><div class="stat-label">진도율</div></div>
  `;

  updateGlobalProgress();
}

// ── Global progress bar ────────────────────────────────
function updateGlobalProgress() {
  if (!state.manifest) return;
  const allHashes = state.allTopics.map(t => t.hash);
  const done = allHashes.filter(h => state.progress[h]).length;
  const pct = allHashes.length ? Math.round(done / allHashes.length * 100) : 0;
  document.getElementById('globalProgressBar').style.width = pct + '%';
  document.getElementById('globalProgressLabel').textContent = pct + '%';
}

// ── Hash navigation ────────────────────────────────────
function onHashChange() {
  const hash = window.location.hash.slice(1);
  if (!hash || hash === '/') {
    showHome();
    return;
  }
  state.currentHash = hash;
  loadContent(hash);
  setActiveNavItem(hash);
}

function showHome() {
  document.getElementById('homeScreen').classList.remove('hidden');
  document.getElementById('markdownView').classList.add('hidden');
  state.currentHash = null;
  setActiveNavItem(null);
  renderHomeCards();
}

function setActiveNavItem(hash) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  if (hash) {
    const item = document.querySelector(`.nav-item[data-hash="${hash}"]`);
    if (item) {
      item.classList.add('active');
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}

// ── Content loading ────────────────────────────────────
async function loadContent(hash) {
  const [subjectId, topicId] = hash.split('/');
  if (!subjectId || !topicId) { showHome(); return; }

  // Determine file path
  let filePath = null;
  let subjectTitle = '시험 정보';
  let topicTitle = topicId;
  let topicTags = [];

  if (subjectId === 'exam') {
    filePath = `content/exam/${topicId}.md`;
    topicTitle = topicId === 'overview' ? '시험 개요' : '채점 기준';
  } else if (state.manifest) {
    const subject = state.manifest.subjects.find(s => s.id === subjectId);
    if (subject) {
      subjectTitle = subject.title;
      const topic = subject.topics.find(t => t.id === topicId);
      if (topic) {
        filePath = topic.file;
        topicTitle = topic.title;
        topicTags = topic.tags || [];
      }
    }
  }

  if (!filePath) { showHome(); return; }

  // Show loading
  document.getElementById('homeScreen').classList.add('hidden');
  const view = document.getElementById('markdownView');
  view.classList.remove('hidden');
  document.getElementById('markdownBody').innerHTML =
    '<p style="color:#94a3b8;padding:20px 0">불러오는 중...</p>';

  try {
    const res = await fetch(filePath + '?v=' + Date.now());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let raw = await res.text();

    // Parse and strip front matter
    const { content, meta } = parseFrontMatter(raw);
    if (meta.title) topicTitle = meta.title;
    if (meta.tags) topicTags = parseTags(meta.tags);

    // Render
    renderMarkdown(content, subjectTitle, topicTitle, topicTags, hash);
    updateNavButtons(hash);
    updateCompleteButton(hash);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    document.getElementById('markdownBody').innerHTML =
      `<p style="color:#ef4444">파일을 불러올 수 없습니다: ${filePath}</p>`;
  }
}

// ── Front Matter parser ────────────────────────────────
function parseFrontMatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { content: raw, meta: {} };

  const meta = {};
  match[1].split('\n').forEach(line => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    meta[key] = val;
  });

  return { content: match[2], meta };
}

function parseTags(tagStr) {
  return tagStr.replace(/[\[\]]/g, '').split(',').map(t => t.trim()).filter(Boolean);
}

// ── Markdown render ────────────────────────────────────
function renderMarkdown(content, subjectTitle, topicTitle, tags, hash) {
  // Breadcrumb
  document.getElementById('breadcrumb').innerHTML =
    `${subjectTitle} <span>›</span> ${topicTitle}`;

  // Tags
  const tagsHtml = tags.length
    ? `<div class="topic-tags">${tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>`
    : '';

  // Render markdown
  marked.setOptions({
    highlight: (code, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
    gfm: true,
    breaks: false,
  });

  const html = marked.parse(content);
  document.getElementById('markdownBody').innerHTML = tagsHtml + html;

  // Re-apply highlight.js to any missed code blocks
  document.querySelectorAll('.markdown-body pre code').forEach(block => {
    hljs.highlightElement(block);
  });
}

// ── Prev / Next navigation ─────────────────────────────
function updateNavButtons(hash) {
  const idx = state.allTopics.findIndex(t => t.hash === hash);
  const btnPrev = document.getElementById('btnPrev');
  const btnNext = document.getElementById('btnNext');

  if (idx > 0) {
    btnPrev.disabled = false;
    btnPrev.textContent = '← ' + getTopicTitle(state.allTopics[idx - 1]);
  } else {
    btnPrev.disabled = true;
    btnPrev.textContent = '← 이전';
  }

  if (idx < state.allTopics.length - 1) {
    btnNext.disabled = false;
    btnNext.textContent = getTopicTitle(state.allTopics[idx + 1]) + ' →';
  } else {
    btnNext.disabled = true;
    btnNext.textContent = '다음 →';
  }
}

function getTopicTitle(topicRef) {
  if (topicRef.subjectId === 'exam') {
    return topicRef.topicId === 'overview' ? '시험 개요' : '채점 기준';
  }
  const subject = state.manifest?.subjects.find(s => s.id === topicRef.subjectId);
  const topic = subject?.topics.find(t => t.id === topicRef.topicId);
  return topic?.title || topicRef.topicId;
}

function navigateTopic(dir) {
  if (!state.currentHash) return;
  const idx = state.allTopics.findIndex(t => t.hash === state.currentHash);
  const next = state.allTopics[idx + dir];
  if (next) window.location.hash = next.hash;
}

// ── Progress (localStorage) ────────────────────────────
function loadProgress() {
  try {
    state.progress = JSON.parse(localStorage.getItem('sqlp-progress') || '{}');
  } catch { state.progress = {}; }
}

function saveProgress() {
  localStorage.setItem('sqlp-progress', JSON.stringify(state.progress));
}

function updateCompleteButton(hash) {
  const btn = document.getElementById('btnComplete');
  const done = !!state.progress[hash];
  btn.textContent = done ? '✅ 학습 완료됨' : '학습 완료 체크';
  btn.classList.toggle('completed', done);
}

function toggleComplete() {
  if (!state.currentHash) return;
  state.progress[state.currentHash] = !state.progress[state.currentHash];
  if (!state.progress[state.currentHash]) delete state.progress[state.currentHash];
  saveProgress();
  updateCompleteButton(state.currentHash);
  // Refresh sidebar item
  const item = document.querySelector(`.nav-item[data-hash="${state.currentHash}"]`);
  if (item) {
    const done = !!state.progress[state.currentHash];
    item.classList.toggle('completed', done);
    item.querySelector('.nav-item-check').textContent = done ? '✅' : '⬜';
  }
  // Update section progress counts
  updateSectionProgress();
  updateGlobalProgress();
}

function updateSectionProgress() {
  if (!state.manifest) return;
  for (const subject of state.manifest.subjects) {
    const header = document.querySelector(`.nav-section[data-section="${subject.id}"] .section-progress`);
    if (!header) continue;
    const done = subject.topics.filter(t => state.progress[`${subject.id}/${t.id}`]).length;
    header.textContent = `${done}/${subject.topics.length}`;
  }
}

// ── Search ─────────────────────────────────────────────
function setupSearch() {
  const input = document.getElementById('searchInput');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll('.nav-item[data-hash]').forEach(item => {
      const title = item.querySelector('.nav-item-title')?.textContent.toLowerCase() || '';
      item.classList.toggle('hidden', q && !title.includes(q));
    });
    // Expand sections that have visible items when searching
    if (q) {
      document.querySelectorAll('.nav-section').forEach(section => {
        const hasVisible = section.querySelectorAll('.nav-item:not(.hidden)').length > 0;
        section.classList.toggle('collapsed', !hasVisible);
      });
    }
  });
}

// ── Hamburger menu ─────────────────────────────────────
function setupMenu() {
  document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('hidden');
  });
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.add('hidden');
}
