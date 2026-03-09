import { firebaseConfig, roomId } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js';
import { getFirestore, collection, addDoc, doc, setDoc, deleteDoc, query, orderBy, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';

const STORAGE_KEY = 'skba-work-pay-static-v1';
const tabs = [
  ['home', '홈'],
  ['calendar', '캘린더'],
  ['pay', '급여'],
  ['chat', '채팅'],
  ['handover', '인수인계'],
  ['team', '인원'],
  ['report', '보고서'],
  ['settings', '설정']
];

const seed = {
  user: { name: '김응준', team: 'Formation', line: 'Line 6', shift: '주간' },
  schedules: [
    { id: '1', date: '2026-03-08', shift: '주간', time: '07:00-15:00', note: '일부 투입' },
    { id: '2', date: '2026-03-09', shift: '야간', time: '23:00-07:00', note: '설비 점검' },
    { id: '3', date: '2026-03-10', shift: '주간', time: '07:00-15:00', note: 'Cell Packing' },
    { id: '4', date: '2026-03-11', shift: '휴무', time: '-', note: '개인 휴무' }
  ],
  handovers: [
    { id: '1', from: '김대리', to: '박사원', date: '2026-03-08 07:25', title: '설비 상태 공유', content: '라인 6 OCV 편차 확인 필요. 오전 투입 전 재점검 요망.' },
    { id: '2', from: '이과장', to: '최대리', date: '2026-03-07 18:10', title: '출하 홀드 사항', content: '140일 이상 Cell 선별 완료분만 투입 진행.' }
  ],
  messages: [
    { id: '1', author: '김대리', text: '오늘 라인6 일정 확인 부탁드립니다.', time: '09:10' },
    { id: '2', author: '김응준', text: '주간 07:00-15:00 일부 투입 예정입니다.', time: '09:12' },
    { id: '3', author: '박사원', text: '설비 점검 완료 후 공유드리겠습니다.', time: '09:18' }
  ],
  workers: [
    { id: '1', name: '김응준', role: '반장', shift: '주간', status: '근무중' },
    { id: '2', name: '최대리', role: '대리', shift: '야간', status: '예정' },
    { id: '3', name: '박사원', role: '사원', shift: '주간', status: '근무중' }
  ],
  payroll: { base: 2500000, night: 320000, overtime: 180000, holiday: 120000, tax: 350000, bonus: 0 },
  settings: { shiftModel: '변동 스케줄', theme: 'navy', language: 'ko' }
};

let state = loadState();
let tab = 'home';
let calendarDate = new Date('2026-03-01');
let syncMode = 'local';
let db = null;
let unsubscribers = [];

const shared = {
  schedules: [...state.schedules],
  handovers: [...state.handovers],
  messages: [...state.messages],
  workers: [...state.workers]
};

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : structuredClone(seed);
  } catch {
    return structuredClone(seed);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function formatMoney(n) { return new Intl.NumberFormat('ko-KR').format(Number(n || 0)); }
function nowStamp() { return new Date().toLocaleString('sv-SE').replace('T', ' ').slice(0, 16); }
function nowTime() { return new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }); }

function render() {
  document.getElementById('headerShift').textContent = state.user.shift;
  const badge = document.getElementById('syncBadge');
  badge.textContent = syncMode === 'firebase' ? 'Firebase 실시간 공유' : '로컬 단독 모드';
  badge.className = `sync-badge ${syncMode === 'firebase' ? 'live' : 'local'}`;

  const nav = document.getElementById('bottomNav');
  nav.innerHTML = tabs.map(([key, label]) => `<button class="${tab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`).join('');
  nav.querySelectorAll('button').forEach(btn => btn.onclick = () => { tab = btn.dataset.tab; render(); });

  const content = document.getElementById('content');
  content.innerHTML = views[tab]();
  bindViewEvents();
}

function card(title, body, right = '') {
  return `<section class="card"><div class="card-head"><h3>${title}</h3>${right}</div>${body}</section>`;
}

function getShared(name) { return syncMode === 'firebase' ? shared[name] : state[name]; }
function setLocalSection(name, data) { state[name] = data; saveState(); render(); }

async function initFirebase() {
  const enabled = firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId;
  if (!enabled) return;
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    syncMode = 'firebase';

    bindCollection('schedules', seed.schedules);
    bindCollection('handovers', seed.handovers);
    bindCollection('messages', seed.messages, true);
    bindCollection('workers', seed.workers);
    render();
  } catch (error) {
    console.error(error);
    syncMode = 'local';
    render();
  }
}

function bindCollection(name, fallback, reverse = false) {
  const q = query(collection(db, 'rooms', roomId, name), orderBy('createdAt', 'desc'));
  const unsub = onSnapshot(q, async (snap) => {
    if (snap.empty) {
      for (let i = 0; i < fallback.length; i += 1) {
        const item = fallback[i];
        await setDoc(doc(collection(db, 'rooms', roomId, name), item.id), { ...item, createdAt: new Date(Date.now() - i * 60000) });
      }
      return;
    }
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    shared[name] = reverse ? data.reverse() : data;
    render();
  });
  unsubscribers.push(unsub);
}

async function addShared(name, payload) {
  if (syncMode !== 'firebase') return;
  await addDoc(collection(db, 'rooms', roomId, name), { ...payload, createdAt: serverTimestamp() });
}

async function setShared(name, id, payload) {
  if (syncMode !== 'firebase') return;
  await setDoc(doc(db, 'rooms', roomId, name, id), { ...payload, createdAt: new Date() });
}

const views = {
  home() {
    const handovers = getShared('handovers').slice(0, 2).map(item => `<div class="list-item"><strong>${item.title}</strong><div>${item.from} → ${item.to}</div><p>${item.content}</p></div>`).join('');
    return `
      ${card('오늘 근무 정보', `
        <div class="kv"><span>이름</span><strong>${state.user.name}</strong></div>
        <div class="kv"><span>부서</span><strong>${state.user.team}</strong></div>
        <div class="kv"><span>스케줄</span><strong>${state.settings.shiftModel}</strong></div>
        <div class="kv"><span>공유 상태</span><strong>${syncMode === 'firebase' ? 'Firebase 실시간 공유' : '로컬 단독 모드'}</strong></div>
      `, `<span class="pill">${state.user.line}</span>`)}
      ${card('빠른 메뉴', `<div class="grid two">${[['calendar','근무 캘린더'],['pay','급여 계산'],['chat','채팅방'],['handover','인수인계'],['team','인원 현황'],['report','작업 보고서']].map(([key,label]) => `<button class="quick-btn" data-quick="${key}">${label}</button>`).join('')}</div>`)}
      ${card('최근 인수인계', handovers || '<p class="mini-help">등록된 인수인계가 없습니다.</p>')}
    `;
  },
  calendar() {
    const schedules = getShared('schedules');
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = Array.from({ length: firstDay + daysInMonth }, (_, i) => i < firstDay ? null : i - firstDay + 1);
    const monthLabel = `${year}년 ${month + 1}월`;
    const selectedMonthSchedules = schedules.filter(s => (s.date || '').startsWith(`${year}-${String(month + 1).padStart(2, '0')}`));
    return `
      ${card('근무 캘린더', `
        <div class="calendar-grid head">${['일','월','화','수','목','금','토'].map(d => `<div>${d}</div>`).join('')}</div>
        <div class="calendar-grid">
          ${cells.map(day => {
            if (!day) return '<div class="calendar-cell"></div>';
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const entry = schedules.find(s => s.date === dateStr);
            return `<div class="calendar-cell ${entry ? 'active' : ''}"><span>${day}</span>${entry ? `<small>${entry.shift}</small>` : ''}</div>`;
          }).join('')}
        </div>
      `, `<div class="month-nav"><button id="prevMonth">‹</button><span>${monthLabel}</span><button id="nextMonth">›</button></div>`)}
      ${card('근무 일정 추가/수정', `
        <label class="field"><span>날짜</span><input type="date" id="scheduleDate" value="${new Date().toISOString().slice(0,10)}" /></label>
        <label class="field"><span>근무</span><select id="scheduleShift"><option>주간</option><option>야간</option><option>휴무</option></select></label>
        <label class="field"><span>시간</span><input id="scheduleTime" value="07:00-15:00" /></label>
        <label class="field"><span>메모</span><input id="scheduleNote" placeholder="특이사항 입력" /></label>
        <button class="primary" id="saveSchedule">일정 저장</button>
      `)}
      ${card('월간 스케줄 목록', selectedMonthSchedules.map(item => `<div class="list-item"><strong>${item.date}</strong><div>${item.shift} / ${item.time}</div><p>${item.note || ''}</p></div>`).join('') || '<p class="mini-help">등록된 일정이 없습니다.</p>')}
    `;
  },
  pay() {
    const p = state.payroll;
    const total = Number(p.base)+Number(p.night)+Number(p.overtime)+Number(p.holiday)+Number(p.bonus)-Number(p.tax);
    return `
      ${card('급여 계산기', `
        ${payField('base','기본급',p.base)}
        ${payField('night','야간수당',p.night)}
        ${payField('overtime','연장수당',p.overtime)}
        ${payField('holiday','휴일수당',p.holiday)}
        ${payField('tax','공제',p.tax)}
        ${payField('bonus','추가수당',p.bonus)}
      `)}
      ${card('예상 실수령액', `<div class="total">${formatMoney(total)}원</div><p class="mini-help">급여는 개인 계산용이라 현재 기기 기준으로만 저장됩니다.</p>`)}
    `;
  },
  chat() {
    const messages = getShared('messages');
    return `
      ${card('현장 채팅', `
        <div class="chat-list">
          ${messages.map(msg => {
            const me = msg.author === state.user.name;
            return `<div class="chat-row ${me ? 'me' : ''}"><div class="chat-bubble">${me ? '' : `<strong>${msg.author}</strong>`}<div>${escapeHtml(msg.text)}</div><small>${msg.time || ''}</small></div></div>`;
          }).join('')}
        </div>
      `, '<span class="pill">공용방</span>')}
      <div class="composer"><input id="messageText" placeholder="메시지를 입력하세요" /><button id="sendMessage">전송</button></div>
    `;
  },
  handover() {
    const handovers = getShared('handovers');
    return `
      ${card('인수인계 작성', `
        <label class="field"><span>보내는 사람</span><input id="handoverFrom" value="${state.user.name}" /></label>
        <label class="field"><span>받는 사람</span><input id="handoverTo" /></label>
        <label class="field"><span>제목</span><input id="handoverTitle" /></label>
        <label class="field"><span>내용</span><textarea rows="5" id="handoverContent" placeholder="현장 작업 보고서 형식으로 작성"></textarea></label>
        <button class="primary" id="saveHandover">인수인계 등록</button>
      `)}
      ${card('인수인계 내역', handovers.map(item => `<div class="list-item"><strong>${item.title}</strong><div>${item.from} → ${item.to}</div><div>${item.date}</div><p>${item.content}</p></div>`).join('') || '<p class="mini-help">등록된 인수인계가 없습니다.</p>')}
    `;
  },
  team() {
    const workers = getShared('workers');
    return `
      ${card('인원 등록/변경', `
        <label class="field"><span>이름</span><input id="workerName" /></label>
        <div class="mini-row">
          <label class="field"><span>직급</span><select id="workerRole"><option>사원</option><option>대리</option><option>과장</option><option>반장</option></select></label>
          <label class="field"><span>근무</span><select id="workerShift"><option>주간</option><option>야간</option><option>휴무</option></select></label>
        </div>
        <label class="field"><span>상태</span><select id="workerStatus"><option>예정</option><option>근무중</option><option>퇴근</option><option>지원</option></select></label>
        <button class="primary" id="saveWorker">인원 저장</button>
      `)}
      ${card('인원 현황', workers.map(worker => `<div class="list-item"><strong>${worker.name} / ${worker.role}</strong><div>${worker.shift}</div><p class="status-green">${worker.status}</p></div>`).join('') || '<p class="mini-help">등록된 인원이 없습니다.</p>')}
    `;
  },
  report() {
    return `
      ${card('작업 보고서 작성', `
        <label class="field"><span>날짜</span><input type="date" id="reportDate" value="${new Date().toISOString().slice(0,10)}" /></label>
        <label class="field"><span>근무</span><select id="reportShift"><option>주간</option><option>야간</option><option>휴무</option></select></label>
        <label class="field"><span>내용</span><textarea rows="8" id="reportDetails">작업 변동\n- 140일 이상 Cell 기존 Hold 해제분 선별 후 투입 진행\n- 라인6 설비 점검 후 정상 가동 확인</textarea></label>
        <button class="primary" id="copyReport">카카오톡 공유용 복사</button>
      `)}
      ${card('미리보기', `<pre class="report-preview" id="reportPreview"></pre>`)}
    `;
  },
  settings() {
    return `
      ${card('설정', `
        <label class="field"><span>스케줄 방식</span><select id="settingShiftModel"><option ${state.settings.shiftModel==='변동 스케줄'?'selected':''}>변동 스케줄</option><option ${state.settings.shiftModel==='3조 2교대 예정'?'selected':''}>3조 2교대 예정</option><option ${state.settings.shiftModel==='고정 주간'?'selected':''}>고정 주간</option></select></label>
        <label class="field"><span>사용자명</span><input id="settingUserName" value="${state.user.name}" /></label>
        <label class="field"><span>라인</span><input id="settingUserLine" value="${state.user.line}" /></label>
        <div class="inline-actions"><button class="secondary" id="saveSettings">설정 저장</button><button class="secondary" id="resetLocal">로컬 초기화</button></div>
        <p class="mini-help">firebase-config.js 값을 입력하면 채팅/인수인계/근무일정/인원현황이 여러 사용자에게 동시에 공유됩니다.</p>
      `)}
    `;
  }
};

function payField(key, label, value) {
  return `<label class="field"><span>${label}</span><input type="number" data-pay="${key}" value="${value}" /></label>`;
}

function escapeHtml(text = '') {
  return text.replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}

function bindViewEvents() {
  document.querySelectorAll('[data-quick]').forEach(btn => btn.onclick = () => { tab = btn.dataset.quick; render(); });

  if (tab === 'calendar') {
    document.getElementById('prevMonth').onclick = () => { calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1); render(); };
    document.getElementById('nextMonth').onclick = () => { calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1); render(); };
    document.getElementById('saveSchedule').onclick = async () => {
      const payload = {
        id: String(Date.now()),
        date: document.getElementById('scheduleDate').value,
        shift: document.getElementById('scheduleShift').value,
        time: document.getElementById('scheduleTime').value,
        note: document.getElementById('scheduleNote').value
      };
      if (syncMode === 'firebase') await setShared('schedules', payload.id, payload);
      else setLocalSection('schedules', [payload, ...state.schedules]);
    };
  }

  if (tab === 'pay') {
    document.querySelectorAll('[data-pay]').forEach(input => {
      input.oninput = () => {
        state.payroll[input.dataset.pay] = Number(input.value || 0);
        saveState();
        render();
      };
    });
  }

  if (tab === 'chat') {
    document.getElementById('sendMessage').onclick = async () => {
      const text = document.getElementById('messageText').value.trim();
      if (!text) return;
      const payload = { id: String(Date.now()), author: state.user.name, text, time: nowTime() };
      if (syncMode === 'firebase') await addShared('messages', payload);
      else setLocalSection('messages', [...state.messages, payload]);
      document.getElementById('messageText').value = '';
    };
  }

  if (tab === 'handover') {
    document.getElementById('saveHandover').onclick = async () => {
      const payload = {
        id: String(Date.now()),
        from: document.getElementById('handoverFrom').value.trim(),
        to: document.getElementById('handoverTo').value.trim(),
        title: document.getElementById('handoverTitle').value.trim(),
        content: document.getElementById('handoverContent').value.trim(),
        date: nowStamp()
      };
      if (!payload.to || !payload.title || !payload.content) return;
      if (syncMode === 'firebase') await addShared('handovers', payload);
      else setLocalSection('handovers', [payload, ...state.handovers]);
      tab = 'handover';
      render();
    };
  }

  if (tab === 'team') {
    document.getElementById('saveWorker').onclick = async () => {
      const payload = {
        id: String(Date.now()),
        name: document.getElementById('workerName').value.trim(),
        role: document.getElementById('workerRole').value,
        shift: document.getElementById('workerShift').value,
        status: document.getElementById('workerStatus').value
      };
      if (!payload.name) return;
      if (syncMode === 'firebase') await setShared('workers', payload.id, payload);
      else setLocalSection('workers', [payload, ...state.workers]);
    };
  }

  if (tab === 'report') {
    const syncPreview = () => {
      const text = `${document.getElementById('reportDate').value} ${document.getElementById('reportShift').value} 특이사항\n${document.getElementById('reportDetails').value}`;
      document.getElementById('reportPreview').textContent = text;
      return text;
    };
    ['reportDate','reportShift','reportDetails'].forEach(id => document.getElementById(id).oninput = syncPreview);
    document.getElementById('copyReport').onclick = async () => {
      const text = syncPreview();
      await navigator.clipboard.writeText(text);
      alert('카카오톡 공유용으로 복사되었습니다.');
    };
    syncPreview();
  }

  if (tab === 'settings') {
    document.getElementById('saveSettings').onclick = () => {
      state.settings.shiftModel = document.getElementById('settingShiftModel').value;
      state.user.name = document.getElementById('settingUserName').value.trim() || state.user.name;
      state.user.line = document.getElementById('settingUserLine').value.trim() || state.user.line;
      saveState();
      render();
    };
    document.getElementById('resetLocal').onclick = () => {
      localStorage.removeItem(STORAGE_KEY);
      state = loadState();
      render();
    };
  }
}

render();
initFirebase();
