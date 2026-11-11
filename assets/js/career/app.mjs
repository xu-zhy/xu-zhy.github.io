import {STORAGE_KEY, createVault, openVault, encrypt, validateEnvelope} from './vault.mjs';
import {schemas, localDate, inRange, filtered, validateTask} from './model.mjs';

const $ = id => document.getElementById(id);
let session = null, revision = null, view = 'dashboard', editing = null, generation = 0, lastActivity = Date.now();
let busy = false;
const titles = {dashboard: '每一步，都算数。', tasks: '把计划，落到今天。', jobs: '让每一次机会有迹可循。', knowledge: '积累属于你的技术底气。'};
const descriptions = {dashboard: '从今天的行动，到下一段职业旅程。', tasks: '连接长期目标与每日行动，专注真正重要的事。', jobs: '记录投递、跟进与每一轮面试的收获。', knowledge: '整理知识、沉淀问题，安排下一次复习。'};
function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}
function button(text, action, className = '') {
  const node = el('button', className, text); node.type = 'button'; node.addEventListener('click', action); return node;
}
function notify(message, error = false) { $('message').textContent = message; $('message').classList.toggle('error', error); }
function gate() {
  try {
    const exists = localStorage.getItem(STORAGE_KEY) !== null;
    $('gate-title').textContent = exists ? '欢迎回来，解锁私人空间' : '创建你的私人空间';
    $('unlock-button').textContent = exists ? '解锁工作台 →' : '创建加密空间 →';
    $('confirm-label').hidden = exists;
    $('confirm-password').required = !exists;
    $('password').autocomplete = exists ? 'current-password' : 'new-password';
    $('password').minLength = exists ? 1 : 12;
  } catch { $('gate-message').textContent = '浏览器禁止了本地存储，请允许此站点存储后重试。'; $('unlock-button').disabled = true; }
}
function lock(message = '工作台已锁定。') {
  generation++; session = null; revision = null; editing = null;
  $('workspace').hidden = true; $('gate').hidden = false;
  $('dashboard').replaceChildren(); $('records').replaceChildren(); $('fields').replaceChildren();
  for (const id of ['editor','restore']) { $(id).close(); $(id).querySelector('form').reset(); }
  $('unlock-form').reset(); $('search').value = ''; $('message').textContent = '';
  $('editor-error').textContent = ''; $('restore-error').textContent = '';
  $('gate-message').textContent = message; gate();
}
function showSession(value, raw) {
  session = value; revision = raw; lastActivity = Date.now();
  $('unlock-form').reset(); $('gate').hidden = true; $('workspace').hidden = false;
  $('gate-message').textContent = ''; changeView('dashboard'); notify('已解锁 · 记录只以密文保存在此浏览器');
}
// Web Locks serializes writes between tabs; compare against the exact prior envelope.
async function write(raw, expected, epoch) {
  await navigator.locks.request('career-os-vault', () => {
    if (generation !== epoch) throw new Error('页面已锁定，请解锁后重试。');
    if (localStorage.getItem(STORAGE_KEY) !== expected) throw new Error('其他页面已更新记录，请重新解锁后再操作。');
    try { localStorage.setItem(STORAGE_KEY, raw); }
    catch { throw new Error('保存失败：本地存储空间不足或被禁用。本次修改未保存，请保留输入并重试。'); }
  });
}
async function commit(next) {
  const epoch = generation, active = session, expected = revision;
  if (!active) throw new Error('请先解锁。');
  const raw = JSON.stringify(await encrypt(next, active.key, active.salt));
  await write(raw, expected, epoch);
  session.data = next; revision = raw;
  notify(`已加密保存 · ${new Date().toLocaleTimeString('zh-CN')}`);
  render();
}
$('unlock-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  busy = true; $('unlock-button').disabled = true; $('gate-message').textContent = '正在处理加密空间…';
  const epoch = generation;
  try {
    const raw = localStorage.getItem(STORAGE_KEY), password = $('password').value;
    if (raw !== null) {
      const opened = await openVault(JSON.parse(raw), password);
      if (generation === epoch && localStorage.getItem(STORAGE_KEY) === raw) showSession(opened, raw);
      else throw new Error('空间发生变化，请重试。');
    } else {
      if (password.length < 12 || password !== $('confirm-password').value) throw new Error('请使用至少 12 位的口令，且两次输入一致。');
      const created = await createVault(password), serialized = JSON.stringify(created.envelope);
      await write(serialized, null, epoch); showSession(created, serialized);
    }
  } catch (error) { $('gate-message').textContent = error.name === 'OperationError' ? '口令不正确或加密数据已损坏，请重试或恢复备份。' : error.message; }
  finally { busy = false; $('unlock-button').disabled = false; }
});
function changeView(next) {
  if (!session) return;
  view = next; $('search').value = ''; $('time-filter').value = 'all';
  $('view-title').textContent = titles[view]; $('view-description').textContent = descriptions[view];
  document.querySelectorAll('[data-view]').forEach(node => node.classList.toggle('active', node.dataset.view === view));
  $('add').textContent = `＋ 新建${schemas[view]?.singular || '任务'}`;
  $('status-filter').replaceChildren(new Option('全部状态',''), ...(schemas[view]?.statuses || []).map(s => new Option(s,s)));
  render();
}
document.querySelectorAll('[data-view]').forEach(node => node.addEventListener('click', () => changeView(node.dataset.view)));
function render() {
  if (!session) return;
  $('today').textContent = new Date().toLocaleDateString('zh-CN', {year:'numeric', month:'long', day:'numeric', weekday:'long'});
  $('dashboard').hidden = view !== 'dashboard'; $('collection').hidden = view === 'dashboard';
  if (view === 'dashboard') renderDashboard(); else renderRecords();
}
function stat(label, value, note, destination) {
  const card = button('', () => changeView(destination), 'stat-card');
  card.append(el('span','muted',label), el('strong','stat-number',value), el('small','muted',note)); return card;
}
function panel(title, note) { const node = el('section','panel'); node.append(el('h2','',title)); if (note) node.append(el('p','muted',note)); return node; }
function renderDashboard() {
  const {tasks,jobs,knowledge} = session.data, root = $('dashboard'); root.replaceChildren();
  const done = tasks.filter(t => t.status === '已完成').length;
  const stats = el('div','stats');
  stats.append(stat('任务完成', `${done} / ${tasks.length}`, `${tasks.length ? Math.round(done/tasks.length*100) : 0}% 完成率`, 'tasks'),
    stat('已投递岗位', jobs.filter(j => j.applied || !['待研究','待投递'].includes(j.status)).length, '包含已进入后续流程的岗位', 'jobs'),
    stat('推进中的面试', jobs.filter(j => ['笔试','技术一面','技术二面','HR 面'].includes(j.status)).length, `${jobs.filter(j => j.status === 'Offer').length} 个当前 Offer`, 'jobs'),
    stat('已掌握知识', knowledge.filter(k => k.status === '已掌握').length, `共积累 ${knowledge.length} 个知识点`, 'knowledge'));
  root.append(stats);
  const grid = el('div','dashboard-grid');
  const phasePanel = panel('职业路线', '用阶段任务连接你的长期目标');
  const phases = tasks.filter(t => t.level === '阶段').sort((a,b) => (a.start || '').localeCompare(b.start || ''));
  if (!phases.length) phasePanel.append(empty('从一个阶段目标开始', '例如：准备实习、完成实习、秋招准备。', () => editRecord('tasks', null, {level:'阶段'})));
  for (const phase of phases) {
    const row = el('div','phase');
    const current = (!phase.start || phase.start <= localDate()) && (!phase.due || phase.due >= localDate()) && phase.status !== '已完成';
    row.append(el('small','eyebrow',current ? '● 当前阶段' : phase.status), button(phase.title, () => editRecord('tasks', phase), 'text-button'), el('p','muted',`${phase.start || '未设开始'} → ${phase.due || '未设截止'}`));
    const children = tasks.filter(t => { let p = t.parent, seen = new Set(); while (p && !seen.has(p)) { if (p === phase.id) return true; seen.add(p); p = tasks.find(x => x.id === p)?.parent; } return false; });
    const progress = el('progress'); progress.max = children.length || 1; progress.value = children.filter(t => t.status === '已完成').length;
    progress.setAttribute('aria-label', `${phase.title} 子任务完成进度`); row.append(progress, el('small','muted',`${progress.value} / ${children.length} 子任务完成`)); phasePanel.append(row);
  }
  grid.append(phasePanel);
  const focus = panel('行动清单', '今日到期、本周重点与逾期任务');
  const todo = filtered(tasks.filter(t => t.status !== '已完成' && (inRange(t,'week') || inRange(t,'overdue'))),'','','all');
  if (!todo.length) focus.append(empty('给今天一个小目标', '添加任务，为计划安排一个明确的日期。', () => editRecord('tasks')));
  todo.slice(0,8).forEach(t => focus.append(recordCard('tasks',t,true)));
  grid.append(focus);
  const next = panel('跟进与复习', '让准备与反馈形成循环');
  const upcoming = [...jobs.filter(j => j.due && !['已拒绝','已结束','Offer'].includes(j.status)).map(j => ['jobs',j]), ...knowledge.filter(k => k.due).map(k => ['knowledge',k])].sort((a,b) => a[1].due.localeCompare(b[1].due));
  if (!upcoming.length) next.append(el('p','empty-note','暂无跟进或复习安排。为岗位和知识点设置日期后，会出现在这里。'));
  upcoming.slice(0,6).forEach(([kind,r]) => next.append(recordCard(kind,r,true)));
  grid.append(next); root.append(grid);
  if (jobs.length) {
    const funnel = panel('求职流程分布'); const chips = el('div','chips');
    schemas.jobs.statuses.forEach(s => chips.append(el('span','chip',`${s} · ${jobs.filter(j => j.status === s).length}`))); funnel.append(chips); root.append(funnel);
  }
}
function empty(title, note, action) {
  const node = el('div','empty'); node.append(el('span','empty-symbol','＋'), el('h3','',title), el('p','muted',note), button('添加第一条记录',action,'quiet')); return node;
}
function recordCard(kind, record, compact = false) {
  const node = el('article', compact ? 'record compact' : 'record');
  const head = el('div','record-head');
  head.append(button(record.company ? `${record.company} · ${record.title}` : record.title, () => editRecord(kind,record), 'text-button'), el('span','chip',record.status || '未设置'));
  node.append(head);
  const metadata = [record.level,record.priority,record.category,record.city,record.project,record.phase].filter(Boolean);
  if (record.parent) metadata.push(`上级：${session.data.tasks.find(t => t.id === record.parent)?.title || '已删除'}`);
  node.append(el('p','record-meta',metadata.join(' / ')));
  if (record.due) node.append(el('p',inRange(record,'overdue') ? 'due overdue' : 'due',`${kind === 'knowledge' ? '复习' : kind === 'jobs' ? '跟进' : '截止'} ${record.due}${inRange(record,'overdue') ? ' · 已逾期' : ''}`));
  if (record.action) node.append(el('p','',record.action));
  if (!compact && record.notes) node.append(el('p','note-preview',record.notes));
  if (!compact) {
    const actions = el('div','record-actions'); actions.append(button('编辑', () => editRecord(kind,record)));
    if (kind === 'tasks' && record.status !== '已完成') actions.append(button('标记完成', async () => {
      if (busy) return; busy = true;
      try { const next = structuredClone(session.data); next.tasks.find(t => t.id === record.id).status = '已完成'; await commit(next); }
      catch (e) { notify(e.message,true); } finally { busy = false; }
    }));
    if (kind === 'jobs') actions.append(button('面试记录', () => editRecord(kind,record,{},true)));
    actions.append(button('删除', async () => {
      if (busy || !confirm(`确认删除“${record.title}”？此操作会在保存后生效。`)) return;
      busy = true;
      try {
        const next = structuredClone(session.data); next[kind] = next[kind].filter(r => r.id !== record.id);
        if (kind === 'tasks') next.tasks.forEach(t => { if (t.parent === record.id) t.parent = ''; });
        await commit(next);
      } catch (e) { notify(e.message,true); } finally { busy = false; }
    },'danger'));
    node.append(actions);
  }
  return node;
}
function renderRecords() {
  const rows = filtered(session.data[view],$('search').value,$('status-filter').value,$('time-filter').value);
  $('records').replaceChildren();
  if (!rows.length) $('records').append(empty(session.data[view].length ? '没有匹配的记录' : '开始积累你的第一条记录', '可以调整筛选，或添加新的内容。', () => editRecord(view)));
  rows.forEach(r => $('records').append(recordCard(view,r)));
}
for (const id of ['search','status-filter','time-filter']) $(id).addEventListener('input',renderRecords);
$('add').addEventListener('click',() => editRecord(view === 'dashboard' ? 'tasks' : view));
function makeField(name,label,type='text',value='',required=false) {
  const wrap = el('label','',label); let input;
  if (Array.isArray(type)) { input = el('select'); type.forEach(v => input.add(new Option(v,v))); }
  else if (type === 'textarea') { input = el('textarea'); input.rows = 4; wrap.classList.add('wide'); }
  else { input = el('input'); input.type = type; }
  input.name = name; input.required = required;
  if (input.tagName !== 'SELECT') input.maxLength = type === 'textarea' ? 20000 : 500;
  input.value = value || (Array.isArray(type) ? type[0] : ''); wrap.append(input); return wrap;
}
function editRecord(kind, record = null, defaults = {}, interviewFocus = false) {
  if (!session || busy) return;
  editing = {kind, id: record?.id || crypto.randomUUID()};
  const current = record || (kind === 'tasks' ? {level:'每日', priority:'P1', ...defaults} : defaults); $('fields').replaceChildren(); $('editor-error').textContent = '';
  $('editor-title').textContent = `${record ? '编辑' : '新建'}${schemas[kind].singular}`;
  for (const [name,label,type,required] of schemas[kind].fields) {
    if (name === 'parent') {
      const field = makeField(name,label,[]); const select = field.querySelector('select'); select.add(new Option('无父级任务',''));
      session.data.tasks.filter(t => t.id !== editing.id).forEach(t => select.add(new Option(t.title,t.id))); select.value = current.parent || ''; $('fields').append(field);
    } else $('fields').append(makeField(name,label,type,current[name],required));
  }
  if (kind === 'jobs') {
    const area = el('section','wide interviews'); area.id = 'interviews'; area.append(el('h3','','面试记录与复盘'));
    const list = el('div'); list.id = 'interview-list'; area.append(list);
    let interviews = []; try { interviews = JSON.parse(current.interviews || '[]'); } catch { /* Older record without interview data. */ }
    area.append(button('＋ 添加一轮面试',() => addInterview())); $('fields').append(area);
    interviews.forEach(i => addInterview(i));
    if (interviewFocus && !interviews.length) addInterview();
  }
  $('editor').showModal();
  if (interviewFocus) $('interviews').scrollIntoView({block:'start'});
}
function addInterview(data = {}) {
  const list = $('interview-list'); if (!list) return;
  const row = el('div','interview-row');
  row.append(makeField('round','轮次','text',data.round,true),makeField('date','面试日期','date',data.date,true),makeField('questions','问题与自己的回答','textarea',data.questions),makeField('gaps','薄弱知识点','textarea',data.gaps),makeField('feedback','反馈与下一步准备','textarea',data.feedback),button('移除此轮',() => row.remove(),'danger'));
  list.append(row);
}
$('edit-form').addEventListener('submit',async event => {
  event.preventDefault(); if (busy || !editing || !session) return;
  busy = true; $('save').disabled = true; const epoch = generation;
  try {
    const {kind,id} = editing; const next = structuredClone(session.data); const record = {id};
    for (const [name] of schemas[kind].fields) record[name] = $('fields').querySelector(`[name="${name}"]`).value.trim();
    if (!record.title || (kind === 'jobs' && !record.company)) throw new Error('请填写名称等必填项。');
    if (kind === 'tasks') validateTask(record,next.tasks);
    if (kind === 'jobs') {
      if (record.url && !/^https?:\/\//i.test(record.url)) throw new Error('岗位链接请使用 http 或 https 地址。');
      record.interviews = JSON.stringify([...document.querySelectorAll('.interview-row')].map(row => Object.fromEntries([...row.querySelectorAll('input,textarea')].map(input => [input.name,input.value.trim()]))));
    }
    const index = next[kind].findIndex(r => r.id === id);
    if (index >= 0) next[kind][index] = record; else next[kind].push(record);
    await commit(next); $('editor').close(); $('fields').replaceChildren(); editing = null;
  } catch (error) { if (generation === epoch) $('editor-error').textContent = error.message; }
  finally { busy = false; $('save').disabled = false; }
});
document.querySelectorAll('[data-close]').forEach(node => node.addEventListener('click',() => $(node.dataset.close).close()));
for (const id of ['editor','restore']) $(id).addEventListener('close',() => {
  // A close event may be delivered after a rapid reopen. Keep the new form intact.
  if ($(id).open) return;
  if (id === 'editor') { $('fields').replaceChildren(); editing = null; }
  else { $('restore-form').reset(); $('restore-error').textContent = ''; }
});
$('export').addEventListener('click',() => {
  if (!session || !revision) return;
  const blob = new Blob([revision],{type:'application/json'}), url = URL.createObjectURL(blob), link = el('a');
  link.href = url; link.download = `career-os-${localDate()}.encrypted.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  notify('已导出加密备份，请保留口令并妥善保存文件。');
});
for (const id of ['import','gate-import']) $(id).addEventListener('click',() => { if (!busy) $('restore').showModal(); });
$('restore-form').addEventListener('submit',async event => {
  event.preventDefault(); if (busy) return;
  busy = true; $('restore-button').disabled = true; const epoch = generation;
  try {
    const expected = localStorage.getItem(STORAGE_KEY), file = $('backup-file').files[0];
    if (!file || file.size > 15000000) throw new Error('请选择不超过 15 MB 的加密备份。');
    const envelope = validateEnvelope(JSON.parse(await file.text()));
    await openVault(envelope,$('backup-password').value);
    await write(JSON.stringify(envelope),expected,epoch);
    lock('备份已恢复，请使用备份的原有口令解锁。');
  } catch (error) { if (generation === epoch) $('restore-error').textContent = error.name === 'OperationError' ? '备份口令错误或文件已损坏，当前记录未更改。' : error.message; }
  finally { busy = false; $('restore-button').disabled = false; }
});
$('lock').addEventListener('click',() => lock());
['pointerdown','keydown'].forEach(name => document.addEventListener(name,() => {
  if (session && Date.now()-lastActivity >= 300000) lock('闲置超过 5 分钟，已自动锁定。');
  else lastActivity = Date.now();
}));
setInterval(() => { if (session && Date.now()-lastActivity >= 300000) lock('闲置超过 5 分钟，已自动锁定。'); },10000);
document.addEventListener('visibilitychange',() => { if (document.hidden) lock('离开页面，已自动锁定。未保存的编辑不会保留。'); });
window.addEventListener('pagehide',() => lock());
window.addEventListener('pageshow',event => { if (event.persisted) lock(); });
window.addEventListener('storage',event => { if (event.key === STORAGE_KEY || event.key === null) lock('本机记录已在另一页面更新，请重新解锁。'); });
if (!globalThis.isSecureContext || !crypto.subtle || !navigator.locks) {
  $('gate-message').textContent = '请使用支持 Web Crypto 与 Web Locks 的现代浏览器，并通过 HTTPS（本地调试可用 localhost）访问。';
  $('unlock-button').disabled = true; $('gate-import').disabled = true;
} else gate();
