  /* ── Firebase ── */
  firebase.initializeApp({
    apiKey:            'AIzaSyAzVOgelTGiW6z7NFjGeFKv7vsYGosYfK4',
    authDomain:        'goddiary-cea6a.firebaseapp.com',
    projectId:         'goddiary-cea6a',
    storageBucket:     'goddiary-cea6a.firebasestorage.app',
    messagingSenderId: '278600994739',
    appId:             '1:278600994739:web:7499353b937f55159e05c6'
  });
  const _fs   = firebase.firestore();
  const _auth = firebase.auth();
  let _currentUser = null;

  function openAuthModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('open');
  }
  function closeAuthModal(id, e) {
    if (e && e.target !== document.getElementById(id)) return;
    var el = document.getElementById(id);
    if (el) el.classList.remove('open');
  }
  function signIn() { openAuthModal('signin-modal'); }
  function doSignIn() {
    closeAuthModal('signin-modal');
    var provider = new firebase.auth.GoogleAuthProvider();
    _auth.signInWithPopup(provider).catch(function(err) {
      if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-closed-by-user') {
        _auth.signInWithRedirect(provider);
      } else {
        console.error('Sign-in error:', err.code, err.message);
      }
    });
  }
  function doSignOut() {
    closeAuthModal('signout-modal');
    _auth.signOut();
  }

  // หลัง redirect กลับมา — ต้อง pick up ผลลัพธ์
  _auth.getRedirectResult().catch(function(err) {
    console.error('Redirect result error:', err.code, err.message);
  });

  _auth.onAuthStateChanged(function(user) {
    _currentUser = user;
    var btn = document.getElementById('auth-btn');
    if (!btn) return;
    if (user) {
      btn.textContent = '● ' + (user.displayName ? user.displayName.split(' ')[0] : 'Godji');
      btn.title = 'Sign out';
      btn.onclick = function() { openAuthModal('signout-modal'); };
      // โหลด Firestore ทุกครั้งที่มี user — ทั้งกรณี sign in ใหม่ และ reload ขณะ sign in อยู่แล้ว
      _db.loadRemote().then(function() {
        renderProjects(); renderCal(); renderTodo();
      });
    } else {
      btn.textContent = 'Sign in';
      btn.title = '';
      btn.onclick = signIn;
    }
  });

  /* ── DB Layer (Firestore + localStorage fallback) ── */
  var _db = (function() {
    var _c = { projects: null, todos: null, travel: null, trip_todos: null };
    function ref(n) { return _fs.collection('app').doc(n); }
    function write(n, data) {
      if (!_currentUser) return;
      ref(n).set(data).catch(function(e) { console.warn('Firestore write:', e); });
    }
    function lsGet(key, def) {
      try { return JSON.parse(localStorage.getItem(key) || 'null') || def; } catch { return def; }
    }
    function lsTodos() {
      var r = {};
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.startsWith('todos_')) { try { r[k.slice(6)] = JSON.parse(localStorage.getItem(k) || '[]'); } catch {} }
      }
      return r;
    }
    function lsTripTodos() {
      var r = {};
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.startsWith('godji_todos_')) { try { r[k.slice(12)] = JSON.parse(localStorage.getItem(k) || '{}'); } catch {} }
      }
      return r;
    }
    function loadLocal() {
      _c.projects   = lsGet('gd_projects', []);
      _c.todos      = lsTodos();
      _c.travel     = lsGet('godji_travel', { wishlist:[], visited:[], budgets:[] });
      _c.trip_todos = lsTripTodos();
    }
    async function loadRemote() {
      try {
        var ss = await Promise.all([ref('projects').get(), ref('todos').get(), ref('travel').get(), ref('trip_todos').get()]);
        _c.projects   = ss[0].exists ? (ss[0].data().items || []) : _c.projects;
        _c.todos      = ss[1].exists ? (ss[1].data().data  || {}) : _c.todos;
        _c.travel     = ss[2].exists ? ss[2].data()               : _c.travel;
        _c.trip_todos = ss[3].exists ? (ss[3].data().data  || {}) : _c.trip_todos;
      } catch(e) {
        console.warn('Firestore unavailable, using localStorage:', e);
      }
    }
    return {
      loadLocal:    loadLocal,
      loadRemote:   loadRemote,
      getProjects:  function()      { return _c.projects || []; },
      setProjects:  function(v)     { _c.projects = v; try { localStorage.setItem('gd_projects', JSON.stringify(v)); } catch {} write('projects', { items: v }); },
      getTodos:     function(k)     { return (_c.todos || {})[k] || []; },
      setTodos:     function(k, v)  { if (!_c.todos) _c.todos = {}; _c.todos[k] = v; try { localStorage.setItem('todos_' + k, JSON.stringify(v)); } catch {} write('todos', { data: _c.todos }); },
      getTravel:    function()      { return _c.travel || { wishlist:[], visited:[], budgets:[] }; },
      setTravel:    function(v)     { _c.travel = v; try { localStorage.setItem('godji_travel', JSON.stringify(v)); } catch {} write('travel', v); },
      getTripTodos: function(id)    { return (_c.trip_todos || {})[id] || {}; },
      setTripTodos: function(id, v) { if (!_c.trip_todos) _c.trip_todos = {}; _c.trip_todos[id] = v; try { localStorage.setItem('godji_todos_' + id, JSON.stringify(v)); } catch {} write('trip_todos', { data: _c.trip_todos }); }
    };
  })();

  /* ── Sidebar toggle ── */
  function toggleSidebar() {
    if (window.innerWidth > 768) {
      var closed = document.body.classList.toggle('sidebar-closed');
      try { localStorage.setItem('sidebar', closed ? 'closed' : 'open'); } catch(e) {}
    } else {
      document.body.classList.toggle('sidebar-open');
    }
  }
  function closeSidebar() { document.body.classList.remove('sidebar-open'); }

  (function initSidebar() {
    try {
      if (window.innerWidth > 768 && localStorage.getItem('sidebar') === 'closed') {
        document.body.classList.add('sidebar-closed');
      }
    } catch(e) {}
  })();

  /* ── Dark mode ── */
  function toggleDarkMode() {
    var isDark = document.body.classList.toggle('dark');
    try { localStorage.setItem('darkMode', isDark ? '1' : '0'); } catch(e) {}
    var btn = document.getElementById('dark-btn');
    if (btn) btn.textContent = isDark ? '☀ Light' : '☽ Dark';
  }
  (function initDarkMode() {
    try {
      if (localStorage.getItem('darkMode') === '1') {
        document.body.classList.add('dark');
        var btn = document.getElementById('dark-btn');
        if (btn) btn.textContent = '☀ Light';
      }
    } catch(e) {}
  })();

  /* ── Navigation ── */
  function showPage(pageId, linkEl, noHistory) {
    var pageEl = document.getElementById('page-' + pageId);
    if (!pageEl) return;
    closeSidebar();
    document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
    pageEl.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(function(a) { a.classList.remove('active'); });
    var navEl = linkEl || document.querySelector('[data-page="' + pageId + '"]');
    if (navEl) navEl.classList.add('active');
    document.querySelector('.main').scrollTop = 0;
    if (!noHistory && location.hash !== '#' + pageId) history.pushState(null, '', '#' + pageId);
    if (pageId === 'home') {
      pageEl.classList.remove('anim-ready');
      requestAnimationFrame(function() { requestAnimationFrame(function() { pageEl.classList.add('anim-ready'); }); });
    }
    if (pageId === 'portfolio') renderPortfolio();
  }

  function handleHash() {
    var hash = location.hash.slice(1) || 'home';
    var tripMatch = hash.match(/^trips\/(.+)$/);
    if (tripMatch) {
      showPage('trips', null, true);
      openTrip(tripMatch[1], true);
    } else {
      if (document.getElementById('trips-detail')) {
        document.getElementById('trips-detail').style.display = 'none';
        document.getElementById('trips-list').style.display = 'block';
      }
      showPage(hash);
    }
  }

  window.addEventListener('popstate', handleHash);

  /* ── Team flip cards ── */
  var teamData = [
    {
      name: 'June', role: 'Chief of Staff', sub: 'หัวหน้าทีม', img: 'Avatars/June.png',
      tagline: 'รับงานทุกอย่าง — ส่งให้คนที่ใช่เสมอ',
      personality: 'นิ่ง เฉียบ พูดน้อยแต่ตรงประเด็น ไม่ตื่นตระหนก มองภาพใหญ่เสมอ ไม่มีงานเฉพาะของตัวเอง — หน้าที่คือรับงานและส่งให้คนที่ใช่',
      duties: ['รับคำสั่งจาก Godji และวิเคราะห์ว่างานนี้เป็นของใคร', 'ส่ง task ให้ทีมที่เหมาะสม', 'ประสานงานหลายคนพร้อมกันเมื่อจำเป็น', 'แสดงผลลัพธ์และบอกว่าใครทำ']
    },
    {
      name: 'Mint', role: 'งาน', sub: 'เลขางาน', img: 'Avatars/Mint.png',
      tagline: 'ไม่มีอะไรหลุดจากมือ — deadline คือชีวิต',
      personality: 'ขยัน ละเอียด จดทุกอย่าง ไม่มีอะไรหลุดจากมือ ชอบ checklist และ deadline ชัดๆ ถามว่า "deadline คือวันไหนคะ?" ก่อนเริ่มงานทุกครั้ง',
      duties: ['บันทึก task ใหม่ที่ Godji บอก', 'อัปเดตสถานะ task ที่เสร็จแล้ว', 'แจ้งเตือน deadline ที่ใกล้มา', 'ถามรายละเอียดเพิ่มเมื่อข้อมูลไม่ครบ']
    },
    {
      name: 'Elly', role: 'การเงิน', sub: 'เลขาการเงิน', img: 'Avatars/Elly.png',
      tagline: 'ตัวเลขไม่โกหก — Elly ก็เหมือนกัน',
      personality: 'ซื่อสัตย์กับตัวเลข บอกความจริงเสมอแม้จะเจ็บปวด ไม่ยอมปัดเศษหรือเฉลี่ยให้รู้สึกดีขึ้น ชอบพูดว่า "ตัวเลขไม่โกหกนะคะ"',
      duties: ['บันทึกค่าใช้จ่ายรายวันทุกรายการ', 'สรุปค่าใช้จ่ายรายหมวดเมื่อถูกถาม', 'แจ้งเตือนเมื่อใช้จ่ายเกิน budget', 'เปรียบเทียบรายจ่ายเดือนนี้กับเดือนที่แล้ว']
    },
    {
      name: 'Max', role: 'หุ้น', sub: 'นักวางแผนความมั่งคั่ง', img: 'Avatars/Max.png',
      tagline: 'เงินคือเครื่องมือ — ไม่ใช่เป้าหมาย',
      personality: 'มั่นใจ คิดระยะยาว มองเงินเป็นเครื่องมือไม่ใช่เป้าหมาย ชอบพูดถึง compound effect และ asset allocation ก่อนนอนทุกคืน',
      duties: ['อัปเดตมูลค่าพอร์ตเมื่อ Godji แจ้ง', 'คำนวณความคืบหน้าสู่เป้าหมายเงินล้าน', 'แนะนำ strategy การลงทุนระยะยาว', 'วิเคราะห์ว่าควรโปะ กยศ. หรือลงทุนต่อ']
    },
    {
      name: 'Big', role: 'สุขภาพ', sub: 'เลขาสุขภาพ', img: 'Avatars/Big.png',
      tagline: 'แค่ 10 นาทีก็ยังดี — ขอให้ลงมือทำ',
      personality: 'พลังงานเยอะ กระตือรือร้น เชียร์ทุกก้าว ไม่ว่าจะเหนื่อยแค่ไหนก็ยังมีคำพูดให้กำลังใจเสมอ ประเภทที่บอกว่า "วันนี้แค่ 10 นาทีก็ยังดีครับ!"',
      duties: ['บันทึกการออกกำลังกายแต่ละครั้ง', 'ติดตามน้ำหนักรายเดือน', 'แนะนำ routine ที่เหมาะกับระดับปัจจุบัน', 'บันทึกนัดหมอ']
    },
    {
      name: 'Noon', role: 'คน', sub: 'เลขาความสัมพันธ์', img: 'Avatars/Noon.png',
      tagline: 'ทุกความสัมพันธ์มีความหมาย — ไม่มีใครถูกลืม',
      personality: 'อบอุ่น จำทุกอย่างเกี่ยวกับคนรอบข้าง จำวันเกิด ความชอบ และครั้งสุดท้ายที่คุย รู้สึกได้ว่าทุกความสัมพันธ์มีความหมาย ไม่มีใครถูกลืม',
      duties: ['บันทึกข้อมูลคนสำคัญ (วันเกิด ความชอบ)', 'แจ้งเตือนวันสำคัญที่ใกล้มา', 'บันทึกนัดหมายสังคม', 'จำครั้งสุดท้ายที่ Godji ติดต่อแต่ละคน']
    },
    {
      name: 'Peter', role: 'เป้าหมาย', sub: 'โค้ชเป้าหมาย', img: 'Avatars/Peter.png',
      tagline: 'ทำหรือไม่ทำ — ไม่รับข้อแก้ตัว',
      personality: 'จริงจัง ไม่รับข้อแก้ตัว ดันให้ออกจาก comfort zone เสมอ พูดตรงๆ ว่าทำได้หรือไม่ได้ ถามว่า "เมื่อวานทำ OKR ข้อไหนไปแล้วครับ?"',
      duties: ['ติดตาม progress ภาษาแต่ละภาษา', 'ติดตาม milestone YouTube channel', 'ตั้งและ review OKR รายเดือน', 'ไม่รับข้อแก้ตัว ถามตรงๆ ว่าทำหรือไม่ทำ']
    }
  ];

  (function buildCards() {
    var grid = document.getElementById('team-grid');
    teamData.forEach(function(p) {
      var dutiesHTML = p.duties.map(function(d) { return '<li>' + d + '</li>'; }).join('');
      grid.innerHTML += (
        '<div class="flip-wrapper" onclick="toggleFlip(this)">' +
          '<div class="flip-inner">' +
            '<div class="flip-front">' +
              '<img class="f-photo" src="' + p.img + '" alt="' + p.name + '">' +
              '<div class="f-tag">' + p.role + '</div>' +
              '<div class="f-overlay">' +
                '<span class="fname">' + p.name + '</span>' +
                '<span class="f-sub">' + p.sub + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="flip-back">' +
              '<div class="back-top">' +
                '<span class="back-role-tag">' + p.role + '</span>' +
                '<span class="back-flip-hint">← กลับ</span>' +
              '</div>' +
              '<div class="back-name">' + p.name + '</div>' +
              '<p class="back-personality">' + p.personality + '</p>' +
              '<ul class="back-duties">' + dutiesHTML + '</ul>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    });
  })();

  function toggleFlip(wrapper) {
    wrapper.querySelector('.flip-inner').classList.toggle('flipped');
  }

  /* ── Team view switcher ── */
  function switchTeamView(view, btn) {
    document.querySelectorAll('.tvs-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    document.getElementById('team-grid-wrap').classList.toggle('hidden', view !== 'grid');
    document.getElementById('team-pipeline-wrap').classList.toggle('active', view === 'pipeline');
  }

  /* ── Pipeline ── */
  var pipelineLayers = [
    {
      dot: '#3D2314', label: 'Orchestrator', sub: 'รับทุก task — วิเคราะห์ — ส่งให้คนที่ใช่',
      members: ['June']
    },
    {
      dot: '#b8860b', label: 'งาน & Deadline', sub: 'task → checklist → done',
      members: ['Mint']
    },
    {
      dot: '#7A5C3F', label: 'การเงิน', sub: 'รายวัน → พอร์ต → เป้าล้าน',
      members: ['Elly', 'Max']
    },
    {
      dot: '#b84040', label: 'ชีวิต & คน', sub: 'สุขภาพ · ความสัมพันธ์',
      members: ['Big', 'Noon']
    },
    {
      dot: '#A67C52', label: 'เป้าหมาย', sub: 'OKR → ภาษา → YouTube',
      members: ['Peter']
    }
  ];

  (function buildPipeline() {
    var container = document.getElementById('pipeline-layers');
    pipelineLayers.forEach(function(layer) {
      var membersHTML = layer.members.map(function(name) {
        var p = teamData.find(function(t) { return t.name === name; });
        if (!p) return '';
        return (
          '<div class="pipe-card">' +
            '<img class="pipe-photo" src="' + p.img + '" alt="' + p.name + '">' +
            '<div class="pipe-info">' +
              '<div class="pipe-name">' + p.name + '</div>' +
              '<div class="pipe-role">' + p.sub + '</div>' +
              '<div class="pipe-tagline">' + (p.tagline || '') + '</div>' +
            '</div>' +
          '</div>'
        );
      }).join('');
      container.innerHTML += (
        '<div class="pipeline-layer">' +
          '<div class="pl-left">' +
            '<div class="pl-dot-row"><span class="pl-dot" style="background:' + layer.dot + '"></span><span class="pl-label">' + layer.label + '</span></div>' +
            '<div class="pl-sub">' + layer.sub + '</div>' +
          '</div>' +
          '<div class="pl-members">' + membersHTML + '</div>' +
        '</div>'
      );
    });
  })();

  /* ── Briefs ── */
  function openBrief(id) {
    var tpl = document.getElementById('brief-' + id);
    if (!tpl) return;
    document.getElementById('brief-body').innerHTML = tpl.innerHTML;
    document.getElementById('briefs-list').style.display = 'none';
    document.getElementById('brief-detail').style.display = 'block';
    document.querySelector('.main').scrollTop = 0;
  }
  function closeBrief() {
    document.getElementById('brief-detail').style.display = 'none';
    document.getElementById('briefs-list').style.display = 'block';
  }

  /* ── Trips ── */
  var friendsData = [
    { id: 'tac',  name: 'แทค',  img: 'Avatars/Friends/Tac.png',  fb: '' },
    { id: 'tong', name: 'ตอง',  img: 'Avatars/Friends/Tong.png', fb: 'https://web.facebook.com/sukunya.meekhun.2025' },
    { id: 'peet', name: 'พีท',  img: 'Avatars/Friends/Peet.png', fb: 'https://web.facebook.com/peerawat.uton' },
    { id: 'boat', name: 'โบ๊ท', img: 'Avatars/Friends/Boat.png', fb: 'https://web.facebook.com/thawatchai.sap' }
  ];

  var tripsData = [
    {
      id: 'chanthaburi', status: 'visited',
      name: 'จันทบุรี', dates: '10–13 ต.ค. 2568',
      companions: 'เพื่อนๆ', duration: '4 วัน 3 คืน',
      companionIds: ['peet', 'tong', 'boat', 'tac'],
      days: [
        { label: 'Day 0', date: 'ศุกร์ 10 ต.ค.', place: 'Bangkok → Rayong', items: [
          { time: '16:00', text: 'ออกเดินทางจาก Bangkok' },
          { time: '22:00', text: 'เช็คอิน Humble Living' }
        ]},
        { label: 'Day 1', date: 'เสาร์ 11 ต.ค.', place: 'Rayong — ทะเล', items: [
          { time: '07:00', text: 'ออกเดินทาง' },
          { time: '09:00', text: 'หาดเตยงาม', url: 'https://www.google.com/maps/search/?api=1&query=หาดเตยงาม+ระยอง' },
          { time: '10:30', text: 'ร้านอาหารเพื่อนทะเล', url: 'https://www.google.com/maps/search/?api=1&query=ร้านอาหารเพื่อนทะเล+ระยอง' },
          { time: '12:30', text: 'ท่าเรือเขาหมาจอ', url: 'https://www.google.com/maps/search/?api=1&query=ท่าเรือเขาหมาจอ+ระยอง' },
          { time: '13:00', text: 'รอบเรือไป + ดำน้ำ', note: '2 ชม.' },
          { time: '15:30', text: 'รอบเรือกลับ' },
          { time: 'เย็น',  text: 'เจ๊ปู แสมสาร', url: 'https://www.google.com/maps/search/?api=1&query=เจ๊ปู+แสมสาร+สัตหีบ' }
        ]},
        { label: 'Day 2', date: 'อาทิตย์ 12 ต.ค.', place: 'Chanthaburi เมือง', items: [
          { time: '07:40', text: 'Check out' },
          { time: '09:00', text: 'หลานเอก คอฟฟี่เฮ้าส์', note: '1 ชม.', url: 'https://www.google.com/maps/search/?api=1&query=หลานเอก+coffee+จันทบุรี' },
          { time: '11:30', text: 'เนินนางพญา', url: 'https://www.google.com/maps/search/?api=1&query=เนินนางพญา+จันทบุรี' },
          { time: '12:10', text: 'วัดปากน้ำแขมหนู', url: 'https://www.google.com/maps/search/?api=1&query=วัดปากน้ำแขมหนู+จันทบุรี' },
          { time: '13:00', text: 'สะพานตากสินมหาราช', url: 'https://www.google.com/maps/search/?api=1&query=สะพานตากสินมหาราช+จันทบุรี' },
          { time: '13:30', text: 'ชุมชนขนมแปลก + กินข้าว', url: 'https://www.google.com/maps/search/?api=1&query=ชุมชนขนมแปลก+จันทบุรี' },
          { time: '14:00', text: 'ล่องแพดูเหยี่ยว', note: '14:00–17:00', url: 'https://www.google.com/maps/search/?api=1&query=ล่องแพดูเหยี่ยว+จันทบุรี' },
          { time: '17:00', text: 'ชุมชนริมน้ำจันทบูร', url: 'https://www.google.com/maps/search/?api=1&query=ชุมชนริมน้ำจันทบูร' },
          { time: '19:00', text: 'อยู่สบายริเวอร์ไซด์', url: 'https://www.google.com/maps/search/?api=1&query=อยู่สบายริเวอร์ไซด์+จันทบุรี' }
        ]},
        { label: 'Day 3', date: 'จันทร์ 13 ต.ค.', place: 'Chanthaburi → Bangkok', items: [
          { time: '08:40', text: 'Check out' },
          { time: '09:00', text: 'อาสนวิหารพระนางมารีอาปฏิสนธินิรมล', url: 'https://www.google.com/maps/search/?api=1&query=Cathedral+Immaculate+Conception+Chanthaburi' },
          { time: '10:00', text: 'Oasis Sea World', note: '1.5 ชม.', url: 'https://www.google.com/maps/search/?api=1&query=Oasis+Sea+World+Chanthaburi' },
          { time: '12:00', text: 'น้ำตกพลิ้ว', note: '1.5 ชม.', url: 'https://www.google.com/maps/search/?api=1&query=Phlio+Waterfall+Chanthaburi' },
          { time: '13:50', text: 'คุ้ยซ่ายวันดี', url: 'https://www.google.com/maps/search/?api=1&query=คุ้ยซ่ายวันดี+จันทบุรี' },
          { time: '14:00', text: 'ก๋วยเตี๋ยวหมูเสียงพระยาตรัง', url: 'https://www.google.com/maps/search/?api=1&query=ก๋วยเตี๋ยวหมูเสียงพระยาตรัง+จันทบุรี' },
          { time: '15:00', text: 'เดินทางกลับ' },
          { time: '19:00', text: 'ถึง Bangkok' }
        ]}
      ]
    },
    {
      id: 'phuphaman', status: 'planning',
      name: 'ภูเวียง → ภูผาม่าน → เชียงคาน', dates: '31 พ.ค. – 2 มิ.ย. 2569',
      companions: 'ซิโบเล็ต ซิโบติ้ว', duration: '3 วัน 2 คืน',
      startDate: '2026-05-31',
      companionIds: ['peet', 'tong', 'boat'],
      todos: [
        { id: 'tatfa',    text: 'โทรเช็คน้ำตกตาดฟ้า ก่อนไป (043-358-073)',     deadline: '30 พ.ค.' },
        { id: 'raft',     text: 'จองล่องแพอ่างเก็บน้ำห้วยม่วง',               deadline: '28 พ.ค.' },
        { id: 'haina',    text: 'จองที่พัก Hai-Na Garden House (096-640-2999)', deadline: '28 พ.ค.' },
        { id: 'homestay', text: 'จองที่พัก ตาหน่วมโฮมสเตย์ เชียงคาน',         deadline: '28 พ.ค.' },
        { id: 'cafe',     text: 'หาคาเฟ่ใกล้ 7-Eleven ออนซอน ภูผาม่าน',       deadline: '30 พ.ค.' },
        { id: 'car',      text: 'เช็คสภาพรถก่อนออก',                           deadline: '30 พ.ค.' },
        { id: 'money',    text: 'เตรียมเงินสด',                                 deadline: '30 พ.ค.' }
      ],
      budget: [
        { label: 'น้ำมัน (ขอนแก่น–เชียงคาน round trip ~550 กม.)', amount: '~1,100 บาท' },
        { label: 'ที่พัก 2 คืน',                                    amount: '~1,600 บาท' },
        { label: 'อาหาร (3 วัน ~3 มื้อ/วัน)',                      amount: '~1,500 บาท' },
        { label: 'ค่าเข้าอุทยานฯ ภูเวียง',                         amount: '~100 บาท' },
        { label: 'ล่องแพอ่างเก็บน้ำห้วยม่วง',                      amount: '~200 บาท' },
        { label: 'ล่องเรือโขง + ปั่นจักรยาน',                      amount: '~150 บาท' },
        { label: 'Skywalk + ฟาร์มแกะ',                              amount: '~160 บาท' },
        { label: 'กาแฟ + ของฝาก',                                   amount: '~500 บาท' },
        { label: 'รวม (ประมาณ)',                                     amount: '~5,310 บาท', total: true }
      ],
      notes: [
        'น้ำตกตาดฟ้า: ปลายพ.ค. น้ำน้อย โทรเช็คก่อน 043-358-073',
        'ถ้ำพญานาคราช: วันอาทิตย์ รอบเช้าเดียวเท่านั้น — อย่าไปสาย | โทร 043-001-753',
        'Somewhere cafe (Day 2 08:00): ยังไม่ได้หาร้าน ต้องหาก่อนออกทริป',
        'บ้านติดดิน: ปิดทุกวันพุธ — 2 มิ.ย. = จันทร์ เปิดปกติ ✓ | โทร 088-022-2999'
      ],
      days: [
        { label: 'Day 1', date: 'เสาร์ 31 พ.ค.', place: 'ภูเวียง + น้ำตกตาดฟ้า + อ่างเก็บน้ำห้วยม่วง', items: [
          { time: '07:30', text: 'ออกจากขอนแก่น → อุทยานแห่งชาติภูเวียง', transit: '~1.5 ชม.', url: 'https://www.google.com/maps/search/?api=1&query=Phu+Wiang+National+Park+Khon+Kaen' },
          { time: '09:00', text: 'อุทยานแห่งชาติภูเวียง — เส้นทางฟอสซิลไดโนเสาร์', duration: '~2 ชม.', transit: '~30 นาที', note: 'เปิด 08:30–16:30', url: 'https://www.google.com/maps/search/?api=1&query=Phu+Wiang+National+Park+Khon+Kaen' },
          { time: '11:00', text: 'น้ำตกตาดฟ้า — รับประทานอาหาร', duration: '~1 ชม.', note: '⚠️ ปลายพ.ค. น้ำน้อย โทรเช็ค 043-358-073', url: 'https://www.google.com/maps/search/?api=1&query=Tat+Fa+Waterfall+Phu+Wiang+Khon+Kaen' },
          { time: '12:00', text: 'เล่นน้ำ', duration: '1 ชม.', transit: '~2 ชม.' },
          { time: '15:00', text: 'อ่างเก็บน้ำห้วยม่วง — ล่องแพ', duration: '~2 ชม.', transit: '~30 นาที', url: 'https://www.google.com/maps/search/?api=1&query=Huai+Muang+Reservoir+Khon+Kaen' },
          { time: '17:30', text: 'ฮักผาม่าน — รับประทานอาหาร', duration: '3 ชม.', url: 'https://www.google.com/maps/search/?api=1&query=Hug+Pha+Man+Restaurant+Phuphaman+Khon+Kaen' },
          { time: '20:30', text: 'เช็คอิน Hai-Na Garden House', note: 'โทร 096-640-2999', url: 'https://www.google.com/maps/search/?api=1&query=Hai+Na+Garden+House+Phuphaman+Khon+Kaen' }
        ]},
        { label: 'Day 2', date: 'อาทิตย์ 1 มิ.ย.', place: 'ภูผาม่าน → ร้านฮักฮูก → เชียงคาน', items: [
          { time: '06:00', text: 'Check out Hai-Na Garden House', transit: '~1.5 ชม.' },
          { time: '07:30', text: '7-Eleven สาขาออนซอน ภูผาม่าน', note: 'จุดถ่ายรูป วิวภูเขา', url: 'https://www.google.com/maps/search/?api=1&query=7-Eleven+ออนซอน+ภูผาม่าน+ขอนแก่น' },
          { time: '08:00', text: 'Somewhere cafe', transit: '~1 ชม.', note: '⚠️ ยังไม่ได้หาร้าน — เช็คก่อนออกทริป' },
          { time: '10:00', text: 'ถ้ำพญานาคราช', duration: '~1 ชม.', transit: '~20 นาที', note: '⚠️ วันอาทิตย์ รอบเช้าเดียว ONLY | โทร 043-001-753',
            details: 'วันอาทิตย์เปิดเฉพาะรอบเช้าเท่านั้น วันธรรมดาเปิดรอบ 13:30', url: 'https://www.google.com/maps/search/?api=1&query=Phaya+Nakarat+Cave+Phuphaman+Khon+Kaen' },
          { time: '12:00', text: 'ร้านฮักฮูก — รับประทานอาหาร', duration: '~1.5 ชม.', transit: '~3 ชม.', url: 'https://www.google.com/maps/search/?api=1&query=ร้านฮักฮูก+ภูผาม่าน+ขอนแก่น' },
          { time: '16:30', text: 'ล่องเรือชมโขง + ปั่นจักรยาน', duration: '~2 ชม.', url: 'https://www.google.com/maps/search/?api=1&query=Kaeng+Khut+Khu+Chiang+Khan+Loei' },
          { time: '18:30', text: 'ถนนคนเดินเชียงคาน — หมูกระทะ', duration: '~2 ชม.', note: 'เปิด 17:00–22:00', url: 'https://www.google.com/maps/search/?api=1&query=Chiang+Khan+Walking+Street+Loei' },
          { time: '20:30', text: 'FREE TIME', duration: '1.5 ชม.' },
          { time: '22:00', text: 'เช็คอิน ตาหน่วมโฮมสเตย์ เชียงคาน', url: 'https://www.google.com/maps/search/?api=1&query=ตาหน่วมโฮมสเตย์+เชียงคาน+เลย' }
        ]},
        { label: 'Day 3', date: 'จันทร์ 2 มิ.ย.', place: 'ทะเลหมอก + ตักบาตร + Skywalk → กลับขอนแก่น', items: [
          { time: '04:00', text: 'เตรียมตัวดูทะเลหมอก' },
          { time: '05:00', text: 'ดูหมอกเช้า + ตักบาตร', duration: '1 ชม.', url: 'https://www.google.com/maps/search/?api=1&query=Phu+Thok+Viewpoint+Chiang+Khan+Loei' },
          { time: '06:00', text: 'กลับที่พัก' },
          { time: '06:30', text: 'กินข้าวเช้า' },
          { time: '08:00', text: 'Check out' },
          { time: '09:00', text: 'บ้านติดดิน คาเฟ่เชียงคาน', duration: '~1.5 ชม.', transit: '~30 นาที', note: 'คาเฟ่ริมโขง | เปิด จ–อา (ปิดพุธ) | โทร 088-022-2999', url: 'https://www.google.com/maps/search/?api=1&query=Baan+Tid+Din+Cafe+Chiang+Khan' },
          { time: '10:30', text: 'สกายวอร์คเชียงคาน', duration: '~30 นาที', transit: '~20 นาที', note: '60 บาท (รวมรถรับส่ง + ถุงคลุมรองเท้า) | เปิด 07:00–18:00', url: 'https://www.google.com/maps/search/?api=1&query=Skywalk+Chiang+Khan+Loei' },
          { time: '11:20', text: 'ฟาร์มแกะ', duration: '~20 นาที', transit: '~10 นาที', note: '100 บาท | โทร 062-551-4939', url: 'https://www.google.com/maps/search/?api=1&query=Sheep+Farm+Chiang+Khan+Loei' },
          { time: '12:10', text: 'ร้านตำดี มีหม้อ', duration: '~1.5 ชม.', url: 'https://www.google.com/maps/search/?api=1&query=ตำดีมีหม้อ+เชียงคาน+เลย' },
          { time: '13:30', text: 'วัดถ้ำผาหมากฮ่อ', duration: '~1.5 ชม.', url: 'https://www.google.com/maps/search/?api=1&query=วัดถ้ำผาหมากฮ่อ+เชียงคาน+เลย' },
          { time: '15:00', text: 'เดินทางกลับขอนแก่น', transit: '~4 ชม.', url: 'https://www.google.com/maps/search/?api=1&query=Khon+Kaen' },
          { time: '19:00', text: 'ถึงขอนแก่น' }
        ]}
      ]
    },
    {
      id: 'laos', status: 'planning',
      name: 'ลาว — โบลาเวน + ตาดฟาน', dates: '31 พ.ค. – 2 มิ.ย. 2569',
      companions: 'ซิโบเล็ต ซิโบติ้ว', duration: '3 วัน 2 คืน',
      startDate: '2026-05-31',
      companionIds: ['peet', 'tong', 'boat'],
      todos: [
        { id: 'laos-confirm', text: 'ตกลงวัน + จำนวนคนกับซิโบ',                              deadline: '18 พ.ค.' },
        { id: 'laos-zip',     text: 'จองซิปไลน์ตาดฟาน ผ่าน Green Discovery Laos',            deadline: '20 พ.ค.' },
        { id: 'laos-pp',      text: 'ทำ passport — ซิโบทุกคน (ใช้บัตรประชาชนไม่ได้)',        deadline: '20 พ.ค.' },
        { id: 'laos-hotel',   text: 'จองที่พัก ปากซอง',                                       deadline: '22 พ.ค.' },
        { id: 'laos-car',     text: 'เช็คสภาพรถก่อนออก',                                      deadline: '29 พ.ค.' },
        { id: 'laos-money',   text: 'แลกเงิน (บาทรับได้ส่วนใหญ่ ไม่ต้องแลกกีบทั้งหมด)',    deadline: '30 พ.ค.' }
      ],
      budget: [
        { label: 'เชื้อเพลิง (หาร 4 คน ขอนแก่น–อุบล–กลับ)',  amount: '~600 บาท' },
        { label: 'ค่าข้ามแดน ช่องเม็ก',                        amount: '~150 บาท' },
        { label: 'ที่พัก 2 คืน ปากซอง',                        amount: '~1,200 บาท' },
        { label: 'อาหาร 6 มื้อ',                               amount: '~900 บาท' },
        { label: 'ซิปไลน์ตาดฟาน (Green Discovery Laos)',       amount: '~1,500–2,000 บาท' },
        { label: 'ค่าเข้าชม / น้ำตก',                          amount: '~200 บาท' },
        { label: 'กาแฟลาว + ของฝาก',                           amount: '~400 บาท' },
        { label: 'รวม (ต่อคน)',                                  amount: '~5,000 บาท', total: true }
      ],
      notes: [
        'คนไทยไม่ต้อง visa เข้าลาว',
        'ใช้ passport เท่านั้น — บัตรประชาชนใช้ไม่ได้',
        'จองซิปไลน์ผ่าน Green Discovery Laos ล่วงหน้า — slot เต็วเร็วมาก',
        'โบลาเวนอากาศเย็น ~20°C — เตรียมเสื้อกันหนาว',
        'ร้านค้าส่วนใหญ่รับบาทไทย ไม่ต้องแลกกีบทั้งหมด'
      ],
      days: [
        { label: 'Day 1', date: 'เสาร์ 31 พ.ค.', place: 'ขอนแก่น → ช่องเม็ก → ปากซอง', items: [
          { time: '06:00', text: 'ออกจากขอนแก่น → อุบลราชธานี', note: '~175 กม. ~2.5 ชม.', url: 'https://www.google.com/maps/search/?api=1&query=Ubon+Ratchathani' },
          { time: '10:30', text: 'ด่านช่องเม็ก — ข้ามแดนเข้าลาว', note: 'ต้องใช้ passport', url: 'https://www.google.com/maps/search/?api=1&query=Chong+Mek+Border+Crossing+Ubon+Ratchathani' },
          { time: '11:30', text: 'เมืองปากเซ — กินข้าวเที่ยง', url: 'https://www.google.com/maps/search/?api=1&query=Pakse+Laos' },
          { time: '15:30', text: 'เช็คอิน ปากซอง', note: '~1.5 ชม. จากปากเซ | อากาศเย็น ~20°C', url: 'https://www.google.com/maps/search/?api=1&query=Paksong+Laos' },
          { time: '17:00', text: 'เดินสวนกาแฟยามเย็น' },
          { time: '19:00', text: 'กินข้าวเย็น ปากซอง', note: '~120 บาท' }
        ]},
        { label: 'Day 2', date: 'อาทิตย์ 1 มิ.ย.', place: 'โบลาเวน — Highlight Day', items: [
          { time: '07:00', text: 'ซิปไลน์ตาดฟาน', note: 'ต้องจองล่วงหน้า Green Discovery Laos | ~1,500–2,000 บาท', url: 'https://www.google.com/maps/search/?api=1&query=Tad+Fane+Zipline+Bolaven+Plateau+Laos' },
          { time: '10:00', text: 'น้ำตกตาดฟาน — จุดชมวิว', note: 'น้ำตกคู่สูง 120 ม.', url: 'https://www.google.com/maps/search/?api=1&query=Tad+Fane+Waterfall+Laos' },
          { time: '12:00', text: 'กินข้าวกลางวัน', note: '~120 บาท' },
          { time: '14:00', text: 'น้ำตกตาดเยือง — เล่นน้ำ', note: 'เดินป่า ~20 นาที | ฟรี', url: 'https://www.google.com/maps/search/?api=1&query=Tad+Yuang+Waterfall+Laos' },
          { time: '16:00', text: 'ไร่กาแฟ + ชิม + ชม sunset', url: 'https://www.google.com/maps/search/?api=1&query=Bolaven+Plateau+Coffee+Farm+Laos' },
          { time: '19:00', text: 'กินข้าวเย็น + พักผ่อน' }
        ]},
        { label: 'Day 3', date: 'จันทร์ 2 มิ.ย.', place: 'วิวเช้า + เดินทางกลับขอนแก่น', items: [
          { time: '07:00', text: 'Check out' },
          { time: '07:30', text: 'ชมหมอกเช้าโบลาเวน', note: 'วิวสวยมากช่วงหน้าฝน' },
          { time: '08:30', text: 'ซื้อกาแฟลาว + ของฝาก', note: 'Jhai Coffee / Dao Coffee' },
          { time: '10:00', text: 'เดินทางกลับขอนแก่น', note: 'ปากซอง → ช่องเม็ก → ขอนแก่น | ถึง ~15:00–16:00', url: 'https://www.google.com/maps/search/?api=1&query=Khon+Kaen' }
        ]}
      ]
    }
  ];

  function buildCompanionStack(ids) {
    if (!ids || !ids.length) return '';
    return '<div class="companion-stack">' +
      ids.map(function(cid) {
        var f = friendsData.find(function(x) { return x.id === cid; });
        return f ? '<img class="comp-avatar" src="' + f.img + '" alt="' + f.name + '" title="' + f.name + '">' : '';
      }).join('') +
    '</div>';
  }

  function buildTripCard(trip) {
    var bottom = trip.companionIds
      ? '<div class="trip-card-bottom">' + buildCompanionStack(trip.companionIds) + '<span class="trip-duration-text">' + trip.duration + '</span></div>'
      : '<div class="trip-meta">' + trip.companions + ' · ' + trip.duration + '</div>';
    return (
      '<a class="trip-card" href="#trips/' + trip.id + '" onclick="event.preventDefault();openTrip(\'' + trip.id + '\')">' +
        '<span class="trip-status ' + trip.status + '">' + (trip.status === 'visited' ? 'เคยไปแล้ว' : 'กำลังวางแผน') + '</span>' +
        '<div class="trip-name">' + trip.name + '</div>' +
        '<div class="trip-dates">' + trip.dates + '</div>' +
        bottom +
        '<span class="trip-arrow">→</span>' +
      '</a>'
    );
  }

  function getTodoState(tripId) { return _db.getTripTodos(tripId); }

  function jumpToSection(id) {
    var el = document.getElementById(id);
    var main = document.querySelector('.main');
    if (!el || !main) return;
    var rect = el.getBoundingClientRect();
    var mainRect = main.getBoundingClientRect();
    main.scrollBy({ top: rect.top - mainRect.top - 58, behavior: 'smooth' });
  }

  (function initScrollTop() {
    var main = document.querySelector('.main');
    var btn = document.getElementById('scroll-top-btn');
    main.addEventListener('scroll', function() {
      btn.classList.toggle('visible', main.scrollTop > 300);
    });
    btn.addEventListener('click', function() {
      main.scrollTo({ top: 0, behavior: 'smooth' });
    });
  })();

  function showCalDeadline(el, tripId) {
    var detail = document.getElementById('tcal-detail-' + tripId);
    if (!detail) return;
    var dateStr = el.dataset.date;
    var items = (el.dataset.dl || '').split('|').filter(Boolean);
    if (detail.classList.contains('visible') && detail.dataset.activeDate === dateStr) {
      detail.classList.remove('visible');
      el.classList.remove('selected');
      return;
    }
    document.querySelectorAll('.tcal-day.selected').forEach(function(d) { d.classList.remove('selected'); });
    el.classList.add('selected');
    detail.innerHTML = '<div class="tcal-day-detail-title">Deadline — ' + dateStr + '</div>' +
      items.map(function(t) { return '<div class="tcal-day-detail-item">· ' + t + '</div>'; }).join('');
    detail.dataset.activeDate = dateStr;
    detail.classList.add('visible');
  }

  function togglePassportGuide(headerEl) {
    headerEl.closest('.passport-guide').classList.toggle('open');
  }

  function toggleDetail(btn) {
    var panel = btn.closest('.tl-text').querySelector('.tl-dpanel');
    if (!panel) return;
    var isOpen = panel.classList.contains('open');
    panel.classList.toggle('open', !isOpen);
    btn.classList.toggle('open', !isOpen);
  }

  function toggleTodo(tripId, todoId) {
    var state = getTodoState(tripId);
    state[todoId] = !state[todoId];
    _db.setTripTodos(tripId, state);
    var item = document.querySelector('[data-todo-id="' + todoId + '"]');
    if (!item) return;
    var done = state[todoId];
    item.querySelector('.todo-check').classList.toggle('checked', done);
    item.querySelector('.todo-label').classList.toggle('done', done);
    var trip = tripsData.find(function(t) { return t.id === tripId; });
    if (trip && trip.todos) {
      var doneCount = trip.todos.filter(function(t) { return state[t.id]; }).length;
      var titleEl = document.querySelector('.trip-todos-title');
      if (titleEl) titleEl.textContent = 'To-do ก่อนไป — ' + doneCount + '/' + trip.todos.length + ' เสร็จแล้ว';
    }
  }

  function buildTripDetail(trip) {
    var todoState = getTodoState(trip.id);

    var todosHTML = '';
    if (trip.todos && trip.todos.length) {
      var doneCount = trip.todos.filter(function(t) { return todoState[t.id]; }).length;
      todosHTML = (
        '<div class="trip-todos" id="trip-sec-todos">' +
          '<div class="trip-todos-title">To-do ก่อนไป — ' + doneCount + '/' + trip.todos.length + ' เสร็จแล้ว</div>' +
          trip.todos.map(function(todo) {
            var done = !!todoState[todo.id];
            return (
              '<div class="todo-item" data-todo-id="' + todo.id + '" onclick="toggleTodo(\'' + trip.id + '\',\'' + todo.id + '\')">' +
                '<div class="todo-check' + (done ? ' checked' : '') + '"></div>' +
                '<span class="todo-label' + (done ? ' done' : '') + '">' + todo.text + '</span>' +
                '<span class="todo-deadline">' + todo.deadline + '</span>' +
              '</div>'
            );
          }).join('') +
        '</div>'
      );
    }

    var daysHTML = trip.days.map(function(day, idx) {
      var itemsHTML = day.items.map(function(item) {
        var textHTML = item.url
          ? '<a class="tl-link" href="' + item.url + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' + item.text + '</a>'
          : item.text;
        var hasDetail = !!(item.details || item.img);
        var toggleBtn = hasDetail ? '<button class="tl-dtoggle" onclick="toggleDetail(this);event.stopPropagation()">▼</button>' : '';
        var detailPanel = hasDetail
          ? '<div class="tl-dpanel">' + (item.img ? '<img src="' + item.img + '" alt="">' : '') + (item.details || '') + '</div>'
          : '';
        return (
          '<div class="tl-row">' +
            '<div class="tl-time-col">' +
              '<span class="tl-time">' + item.time + '</span>' +
              (item.transit ? '<span class="tl-transit">' + item.transit + '</span>' : '') +
            '</div>' +
            '<span class="tl-dot"></span>' +
            '<span class="tl-text">' + textHTML + (item.duration ? '<span class="tl-duration">' + item.duration + '</span>' : '') + toggleBtn + (item.note ? '<span class="tl-note">' + item.note + '</span>' : '') + detailPanel + '</span>' +
          '</div>'
        );
      }).join('');
      return (
        '<div class="day-card" id="trip-sec-' + idx + '">' +
          '<div class="day-header">' +
            '<span class="day-label">' + day.label + '</span>' +
            '<span class="day-date">' + day.date + '</span>' +
            '<span class="day-place">' + day.place + '</span>' +
          '</div>' +
          '<div class="timeline">' + itemsHTML + '</div>' +
        '</div>'
      );
    }).join('');

    var budgetHTML = '';
    if (trip.budget) {
      budgetHTML = (
        '<div class="trip-budget" id="trip-sec-budget">' +
          '<div class="trip-budget-title">Budget (ต่อคน)</div>' +
          trip.budget.map(function(row) {
            return '<div class="tbb-row' + (row.total ? ' total' : '') + '"><span class="tbb-label">' + row.label + '</span><span>' + row.amount + '</span></div>';
          }).join('') +
        '</div>'
      );
    }

    var notesHTML = '';
    if (trip.notes && trip.notes.length) {
      notesHTML = (
        '<div class="trip-notes" id="trip-sec-notes">' +
          '<div class="trip-notes-title">หมายเหตุสำคัญ</div>' +
          '<ul>' + trip.notes.map(function(n) { return '<li>' + n + '</li>'; }).join('') + '</ul>' +
        '</div>'
      );
    }

    var passportHTML = '';
    if (trip.passportGuide) {
      var pg = trip.passportGuide;
      var docsHTML = pg.docs.map(function(d) {
        return '<div class="pg-doc"><span class="pg-check">✓</span><span>' + d + '</span></div>';
      }).join('');
      var stepsHTML = pg.steps.map(function(s, i) {
        var label = s.url
          ? '<a class="tl-link" href="' + s.url + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' + s.text + '</a>'
          : s.text;
        return (
          '<div class="pg-step">' +
            '<div class="pg-step-num">' + (i + 1) + '</div>' +
            '<div class="pg-step-text">' + label + (s.note ? '<span class="pg-step-note">' + s.note + '</span>' : '') + '</div>' +
          '</div>'
        );
      }).join('');
      var feesHTML = pg.fees.map(function(f) {
        return '<div class="pg-fee-item"><strong>' + f.amount + '</strong>' + f.label + '</div>';
      }).join('');
      passportHTML = (
        '<div class="passport-guide">' +
          '<div class="pg-header" onclick="togglePassportGuide(this)">' +
            '<span style="font-size:1.1rem;">📘</span>' +
            '<span class="pg-header-title">คู่มือทำ Passport ครั้งแรก — สำหรับซิโบเล็ต ซิโบติ้ว</span>' +
            '<span class="pg-header-badge">URGENT</span>' +
            '<span class="pg-arrow">▼</span>' +
          '</div>' +
          '<div class="pg-body">' +
            '<div class="pg-deadline">' + pg.deadline + '</div>' +
            '<div class="pg-location">' +
              '<strong>สถานที่ยื่น: </strong>' +
              '<a class="tl-link" href="' + pg.locationUrl + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' + pg.location + '</a>' +
            '</div>' +
            '<div class="pg-section-title">เอกสารที่ต้องเตรียม</div>' +
            '<div class="pg-docs">' + docsHTML + '</div>' +
            '<div class="pg-section-title">ขั้นตอน</div>' +
            '<div class="pg-steps">' + stepsHTML + '</div>' +
            '<div class="pg-section-title">ค่าธรรมเนียม</div>' +
            '<div class="pg-fee">' + feesHTML + '</div>' +
          '</div>' +
        '</div>'
      );
    }

    var calendarHTML = '';
    if (trip.status === 'planning' && trip.startDate && trip.days) {
      var thMonths = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
      var thDow = ['อา','จ','อ','พ','พฤ','ศ','ส'];
      var thMonthNums = {'ม.ค.':1,'ก.พ.':2,'มี.ค.':3,'เม.ย.':4,'พ.ค.':5,'มิ.ย.':6,'ก.ค.':7,'ส.ค.':8,'ก.ย.':9,'ต.ค.':10,'พ.ย.':11,'ธ.ค.':12};
      var tripStart = new Date(trip.startDate);
      var tripYear = tripStart.getFullYear();
      var numD = trip.days.length;
      var tripEnd = new Date(tripStart); tripEnd.setDate(tripEnd.getDate() + numD - 1);

      // trip day map
      var dateMap = {};
      for (var di = 0; di < numD; di++) {
        var dd = new Date(tripStart); dd.setDate(dd.getDate() + di);
        dateMap[dd.getFullYear() + '-' + dd.getMonth() + '-' + dd.getDate()] = di;
      }

      // deadline map: parse "18 พ.ค." → date key → todos[]
      var deadlineMap = {};
      if (trip.todos) {
        trip.todos.forEach(function(todo) {
          if (!todo.deadline) return;
          var parts = todo.deadline.trim().split(' ');
          if (parts.length < 2) return;
          var dDay = parseInt(parts[0]);
          var dMon = thMonthNums[parts[1]];
          if (!dMon || isNaN(dDay)) return;
          var dObj = new Date(tripYear, dMon - 1, dDay);
          var dKey = dObj.getFullYear() + '-' + dObj.getMonth() + '-' + dObj.getDate();
          if (!deadlineMap[dKey]) deadlineMap[dKey] = [];
          deadlineMap[dKey].push(todo);
        });
      }

      // expand calendar start to earliest deadline month
      var calStart = new Date(tripStart.getFullYear(), tripStart.getMonth(), 1);
      Object.keys(deadlineMap).forEach(function(k) {
        var p = k.split('-');
        var dlMo = new Date(parseInt(p[0]), parseInt(p[1]), 1);
        if (dlMo < calStart) calStart = new Date(dlMo);
      });

      var months = [];
      var mc = new Date(calStart);
      var me = new Date(tripEnd.getFullYear(), tripEnd.getMonth(), 1);
      while (mc <= me) { months.push({ y: mc.getFullYear(), m: mc.getMonth() }); mc.setMonth(mc.getMonth() + 1); }

      calendarHTML = '<div class="trip-calendar" id="trip-sec-calendar">';
      months.forEach(function(mo) {
        var firstDow = new Date(mo.y, mo.m, 1).getDay();
        var dim = new Date(mo.y, mo.m + 1, 0).getDate();
        calendarHTML += '<div class="tcal-month-head">' + thMonths[mo.m] + ' ' + (mo.y + 543) + '</div>';
        calendarHTML += '<div class="tcal-grid">';
        thDow.forEach(function(d) { calendarHTML += '<span class="tcal-dow">' + d + '</span>'; });
        for (var b = 0; b < firstDow; b++) calendarHTML += '<span></span>';
        for (var day = 1; day <= dim; day++) {
          var key = mo.y + '-' + mo.m + '-' + day;
          var tripIdx = dateMap[key];
          var dlList = deadlineMap[key] || [];
          if (tripIdx !== undefined) {
            calendarHTML += '<span class="tcal-day is-trip">' + day + '<span class="tcal-dlabel">D' + (tripIdx + 1) + '</span></span>';
          } else if (dlList.length > 0) {
            var dot = dlList.length > 1
              ? '<span class="tcal-ddot multi">' + dlList.length + '</span>'
              : '<span class="tcal-ddot"></span>';
            var dlTexts = dlList.map(function(t) { return t.text; }).join('|').replace(/'/g,'&#39;');
            var dDateStr = day + ' ' + thMonths[mo.m];
            calendarHTML += '<span class="tcal-day has-dl" data-dl="' + dlTexts + '" data-date="' + dDateStr + '" onclick="showCalDeadline(this,\'' + trip.id + '\')">' + day + dot + '</span>';
          } else {
            calendarHTML += '<span class="tcal-day">' + day + '</span>';
          }
        }
        calendarHTML += '</div>';
      });

      calendarHTML += '<div class="tcal-day-detail" id="tcal-detail-' + trip.id + '"></div>';

      // Legend — activities
      calendarHTML += '<div class="tcal-legend">';
      calendarHTML += '<div class="tcal-leg-section">กิจกรรม</div>';
      trip.days.forEach(function(day) {
        calendarHTML += '<div class="tcal-leg-row"><span class="tcal-leg-dot"></span><span><span class="tcal-leg-label">' + day.label + ' · ' + day.date + '</span><span class="tcal-leg-place">' + day.place + '</span></span></div>';
      });

      // Legend — deadlines grouped by date
      var dlKeys = Object.keys(deadlineMap).sort();
      if (dlKeys.length) {
        calendarHTML += '<div class="tcal-leg-section tcal-dl-section">Deadlines</div>';
        dlKeys.forEach(function(k) {
          var p = k.split('-');
          var dObj = new Date(parseInt(p[0]), parseInt(p[1]), parseInt(p[2]));
          var dateStr = dObj.getDate() + ' ' + thMonths[dObj.getMonth()];
          deadlineMap[k].forEach(function(todo) {
            calendarHTML += '<div class="tcal-leg-row"><span class="tcal-leg-ddot"></span><span><span class="tcal-leg-label tcal-dl-date">' + dateStr + '</span><span class="tcal-leg-place">' + todo.text + '</span></span></div>';
          });
        });
      }

      calendarHTML += '</div></div>';
    }

    var companionsRowHTML = '';
    if (trip.companionIds && trip.companionIds.length) {
      companionsRowHTML = '<div class="trip-companions-row">' +
        trip.companionIds.map(function(cid) {
          var f = friendsData.find(function(x) { return x.id === cid; });
          if (!f) return '';
          return '<div class="tcr-item"><img class="tcr-avatar" src="' + f.img + '" alt="' + f.name + '"><span class="tcr-name">' + f.name + '</span></div>';
        }).join('') +
      '</div>';
    }

    var jumpChips = trip.days.map(function(day, idx) {
      return '<span class="trip-jump-chip" onclick="jumpToSection(\'trip-sec-' + idx + '\')">' + day.label + '</span>';
    });
    if (calendarHTML) jumpChips.push('<span class="trip-jump-chip" onclick="jumpToSection(\'trip-sec-calendar\')">ปฏิทิน</span>');
    if (todosHTML) jumpChips.push('<span class="trip-jump-chip" onclick="jumpToSection(\'trip-sec-todos\')">To-do</span>');
    if (budgetHTML) jumpChips.push('<span class="trip-jump-chip" onclick="jumpToSection(\'trip-sec-budget\')">Budget</span>');
    if (notesHTML) jumpChips.push('<span class="trip-jump-chip" onclick="jumpToSection(\'trip-sec-notes\')">หมายเหตุ</span>');
    var jumpNavHTML = '<div class="trip-jump-nav">' + jumpChips.join('') + '</div>';

    return (
      '<div class="trip-detail-head">' +
        '<div class="trip-detail-status"><span class="trip-status ' + trip.status + '">' + (trip.status === 'visited' ? 'เคยไปแล้ว' : 'กำลังวางแผน') + '</span></div>' +
        '<div class="trip-detail-title">' + trip.name + '</div>' +
        '<div class="trip-detail-meta">' + trip.dates + ' · ' + trip.duration + '</div>' +
        companionsRowHTML +
      '</div>' +
      jumpNavHTML +
      passportHTML +
      '<div class="trip-detail-layout">' +
        '<div class="trip-detail-main"><div class="days-list">' + daysHTML + '</div></div>' +
        '<div class="trip-detail-aside" id="trip-sec-aside">' + calendarHTML + todosHTML + budgetHTML + notesHTML + '</div>' +
      '</div>'
    );
  }

  function openTrip(id, skipHistory) {
    var trip = tripsData.find(function(t) { return t.id === id; });
    if (!trip) return;
    document.getElementById('trip-detail-body').innerHTML = buildTripDetail(trip);
    document.getElementById('trips-list').style.display = 'none';
    document.getElementById('trips-detail').style.display = 'block';
    document.querySelector('.main').scrollTop = 0;
    if (!skipHistory) history.pushState(null, '', '#trips/' + id);
  }

  function closeTrip() {
    document.getElementById('trips-detail').style.display = 'none';
    document.getElementById('trips-list').style.display = 'block';
    history.pushState(null, '', '#trips');
  }

  (function buildTripCards() {
    var vGrid = document.getElementById('visited-trips-grid');
    var pGrid = document.getElementById('planning-trips-grid');
    tripsData.forEach(function(trip) {
      var html = buildTripCard(trip);
      if (trip.status === 'visited') vGrid.innerHTML += html;
      else pGrid.innerHTML += html;
    });
  })();

  function renderPeople() {
    var grid = document.getElementById('people-grid');
    var countEl = document.getElementById('people-count');
    if (!grid) return;
    if (countEl) countEl.textContent = friendsData.length + ' คน';
    grid.innerHTML = friendsData.map(function(f) {
      var trips = tripsData.filter(function(t) {
        return t.companionIds && t.companionIds.indexOf(f.id) !== -1;
      });
      var tripsHTML = trips.length
        ? '<div class="person-trips">' + trips.map(function(t) { return '<span class="person-trip-tag">' + t.name + '</span>'; }).join('') + '</div>'
        : '<span style="font-size:0.8rem;color:var(--muted)">ยังไม่มีทริปที่บันทึกไว้</span>';
      return (
        '<div class="flip-wrapper" onclick="toggleFlip(this)">' +
          '<div class="flip-inner">' +
            '<div class="flip-front">' +
              '<img class="f-photo" src="' + f.img + '" alt="' + f.name + '">' +
              '<div class="f-overlay">' +
                '<span class="fname">' + f.name + '</span>' +
                '<span class="f-sub">' + (trips.length ? trips.length + ' ทริปด้วยกัน' : 'ซิโบเล็ต ซิโบติ้ว') + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="flip-back">' +
              '<div class="back-top">' +
                '<span class="back-role-tag">ซิโบเล็ต ซิโบติ้ว</span>' +
                '<span class="back-flip-hint">← กลับ</span>' +
              '</div>' +
              '<span style="font-family:Caveat,cursive;font-size:1.6rem;font-weight:600;color:var(--green-dark);display:block;margin-bottom:0.85rem">' + f.name + '</span>' +
              '<div style="font-size:0.67rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);margin-bottom:0.5rem">ทริปด้วยกัน</div>' +
              tripsHTML +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }
  renderPeople();

  /* ── Travel ── */
  var travelDB = {
    load: function() { return _db.getTravel(); },
    save: function(data) { _db.setTravel(data); }
  };

  function switchTravelTab(tab) {
    document.querySelectorAll('.travel-tab').forEach(function(t) {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.querySelectorAll('.travel-panel').forEach(function(p) {
      p.style.display = (p.id === 'travel-' + tab) ? 'block' : 'none';
    });
  }

  function tuid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function tesc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function tfmt(n) {
    return Number(n || 0).toLocaleString('th-TH');
  }

  /* Wishlist */
  function renderWishlist() {
    var data = travelDB.load();
    var el = document.getElementById('wishlist-cards');
    if (!el) return;
    if (!data.wishlist.length) {
      el.innerHTML = '<div class="empty-state"><span class="empty-icon">🗺️</span>ยังไม่มีที่อยากไป — เพิ่มได้เลยค่ะ</div>';
      return;
    }
    var order = { high: 0, mid: 1, low: 2 };
    var sorted = data.wishlist.slice().sort(function(a, b) { return (order[a.priority]||2) - (order[b.priority]||2); });
    var labels = { high: 'Top priority', mid: 'Medium', low: 'Someday' };
    el.innerHTML = sorted.map(function(item) {
      return (
        '<div class="travel-card">' +
          '<div class="tc-place">' + tesc(item.destination) + '</div>' +
          '<div class="tc-country">' + tesc(item.country) + '</div>' +
          (item.notes ? '<div class="tc-notes">' + tesc(item.notes) + '</div>' : '') +
          '<div class="tc-meta">' +
            '<span class="tc-tag priority-' + (item.priority||'low') + '">' + (labels[item.priority]||'Someday') + '</span>' +
            '<span class="tc-date">' + item.addedDate + '</span>' +
          '</div>' +
          '<div class="tc-actions">' +
            '<button class="tc-btn" onclick="markVisited(\'' + item.id + '\')">✓ เคยไปแล้ว</button>' +
            '<button class="tc-btn danger" onclick="deleteWishlist(\'' + item.id + '\')">ลบ</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function addWishlist(e) {
    e.preventDefault();
    var f = document.getElementById('form-wishlist');
    var dest = f.querySelector('[name=destination]').value.trim();
    if (!dest) return;
    var data = travelDB.load();
    data.wishlist.push({
      id: tuid(),
      destination: dest,
      country: f.querySelector('[name=country]').value.trim(),
      notes: f.querySelector('[name=notes]').value.trim(),
      priority: f.querySelector('[name=priority]').value,
      addedDate: new Date().toISOString().slice(0, 10)
    });
    travelDB.save(data);
    f.reset();
    renderWishlist();
    updateTravelStats();
  }

  function deleteWishlist(id) {
    var data = travelDB.load();
    data.wishlist = data.wishlist.filter(function(x) { return x.id !== id; });
    travelDB.save(data);
    renderWishlist();
    updateTravelStats();
  }

  function markVisited(id) {
    var data = travelDB.load();
    var item = data.wishlist.find(function(x) { return x.id === id; });
    if (!item) return;
    data.wishlist = data.wishlist.filter(function(x) { return x.id !== id; });
    data.visited.push({
      id: tuid(),
      destination: item.destination,
      country: item.country,
      notes: item.notes,
      visitDate: new Date().toISOString().slice(0, 10)
    });
    travelDB.save(data);
    renderWishlist();
    renderVisited();
    updateTravelStats();
  }

  /* Visited */
  function renderVisited() {
    var data = travelDB.load();
    var el = document.getElementById('visited-cards');
    if (!el) return;
    var tripVisited = tripsData.filter(function(t) { return t.status === 'visited'; });
    if (!data.visited.length && !tripVisited.length) {
      el.innerHTML = '<div class="empty-state"><span class="empty-icon">✈️</span>ยังไม่มีที่เคยไป — เพิ่มได้เลยค่ะ</div>';
      return;
    }
    var html = '';
    tripVisited.forEach(function(trip) {
      html += (
        '<div class="travel-card">' +
          '<div class="tc-place">' + tesc(trip.name) + '</div>' +
          '<div class="tc-country">ไทย</div>' +
          '<div class="tc-meta">' +
            '<span class="tc-tag visited-tag">เคยไปแล้ว</span>' +
            '<span class="tc-date">' + tesc(trip.dates) + '</span>' +
          '</div>' +
          '<div class="tc-actions">' +
            '<button class="tc-btn" onclick="showPage(\'trips\',document.querySelector(\'[data-page=trips]\'));openTrip(\'' + trip.id + '\')">ดู itinerary →</button>' +
          '</div>' +
        '</div>'
      );
    });
    var sorted = data.visited.slice().sort(function(a, b) { return (b.visitDate||'').localeCompare(a.visitDate||''); });
    sorted.forEach(function(item) {
      html += (
        '<div class="travel-card">' +
          '<div class="tc-place">' + tesc(item.destination) + '</div>' +
          '<div class="tc-country">' + tesc(item.country) + '</div>' +
          (item.notes ? '<div class="tc-notes">' + tesc(item.notes) + '</div>' : '') +
          '<div class="tc-meta">' +
            '<span class="tc-tag visited-tag">เคยไปแล้ว</span>' +
            '<span class="tc-date">' + (item.visitDate||'') + '</span>' +
          '</div>' +
          '<div class="tc-actions">' +
            '<button class="tc-btn danger" onclick="deleteVisited(\'' + item.id + '\')">ลบ</button>' +
          '</div>' +
        '</div>'
      );
    });
    el.innerHTML = html;
  }

  function addVisited(e) {
    e.preventDefault();
    var f = document.getElementById('form-visited');
    var dest = f.querySelector('[name=destination]').value.trim();
    if (!dest) return;
    var data = travelDB.load();
    data.visited.push({
      id: tuid(),
      destination: dest,
      country: f.querySelector('[name=country]').value.trim(),
      notes: f.querySelector('[name=notes]').value.trim(),
      visitDate: f.querySelector('[name=visitDate]').value || new Date().toISOString().slice(0, 10)
    });
    travelDB.save(data);
    f.reset();
    renderVisited();
    updateTravelStats();
  }

  function deleteVisited(id) {
    var data = travelDB.load();
    data.visited = data.visited.filter(function(x) { return x.id !== id; });
    travelDB.save(data);
    renderVisited();
    updateTravelStats();
  }

  /* Budget */
  function renderBudgets() {
    var data = travelDB.load();
    var el = document.getElementById('budget-cards');
    if (!el) return;
    if (!data.budgets.length) {
      el.innerHTML = '<div class="empty-state"><span class="empty-icon">💰</span>ยังไม่มีงบทริป — เพิ่มได้เลยค่ะ</div>';
      return;
    }
    var sorted = data.budgets.slice().sort(function(a, b) { return (a.startDate||'').localeCompare(b.startDate||''); });
    el.innerHTML = '<div class="travel-grid">' + sorted.map(function(item) {
      var pct = item.budget > 0 ? Math.min(100, Math.round((item.spent||0) / item.budget * 100)) : 0;
      var over = (item.spent||0) > item.budget;
      var remaining = item.budget - (item.spent||0);
      var dates = (item.startDate && item.endDate) ? item.startDate + ' → ' + item.endDate : (item.startDate || '');
      return (
        '<div class="budget-card">' +
          '<div class="bc-title">' + tesc(item.destination) + '</div>' +
          '<div class="bc-dates">' + dates + '</div>' +
          '<div class="budget-bar-wrap"><div class="budget-bar-fill' + (over ? ' over' : '') + '" style="width:' + pct + '%"></div></div>' +
          '<div class="bc-numbers"><span class="bc-spent">' + tfmt(item.spent) + ' บาท</span><span>' + tfmt(item.budget) + ' บาท</span></div>' +
          '<div class="bc-remaining' + (over ? ' over' : '') + '">' + (over ? 'เกินงบ ' + tfmt(Math.abs(remaining)) + ' บาท' : 'เหลือ ' + tfmt(remaining) + ' บาท (' + pct + '%)') + '</div>' +
          '<div class="tc-actions">' +
            '<input type="number" id="spend-' + item.id + '" class="bc-amount-input" placeholder="บาท" min="0">' +
            '<button class="tc-btn" onclick="logExpense(\'' + item.id + '\')">+ บันทึก</button>' +
            '<button class="tc-btn danger" onclick="deleteBudget(\'' + item.id + '\')">ลบ</button>' +
          '</div>' +
        '</div>'
      );
    }).join('') + '</div>';
  }

  function addBudget(e) {
    e.preventDefault();
    var f = document.getElementById('form-budget');
    var dest = f.querySelector('[name=destination]').value.trim();
    if (!dest) return;
    var data = travelDB.load();
    data.budgets.push({
      id: tuid(),
      destination: dest,
      budget: parseFloat(f.querySelector('[name=budget]').value) || 0,
      spent: 0,
      startDate: f.querySelector('[name=startDate]').value,
      endDate: f.querySelector('[name=endDate]').value
    });
    travelDB.save(data);
    f.reset();
    renderBudgets();
    updateTravelStats();
  }

  function logExpense(id) {
    var input = document.getElementById('spend-' + id);
    var amount = parseFloat(input ? input.value : 0);
    if (!amount || isNaN(amount) || amount <= 0) return;
    var data = travelDB.load();
    var item = data.budgets.find(function(x) { return x.id === id; });
    if (!item) return;
    item.spent = (item.spent || 0) + amount;
    travelDB.save(data);
    renderBudgets();
  }

  function deleteBudget(id) {
    var data = travelDB.load();
    data.budgets = data.budgets.filter(function(x) { return x.id !== id; });
    travelDB.save(data);
    renderBudgets();
    updateTravelStats();
  }

  function updateTravelStats() {
    var data = travelDB.load();
    var tripVisitedCount = tripsData.filter(function(t) { return t.status === 'visited'; }).length;
    var w = document.getElementById('stat-wish');
    var v = document.getElementById('stat-visit');
    var b = document.getElementById('stat-budg');
    if (w) w.textContent = data.wishlist.length;
    if (v) v.textContent = data.visited.length + tripVisitedCount;
    if (b) b.textContent = data.budgets.length;
  }

  (function initTravel() {
    renderWishlist();
    renderVisited();
    renderBudgets();
    updateTravelStats();
  })();

  /* ── Page owner banners ── */
  (function buildPageOwners() {
    var owners = {
      home:   { name: 'June',  desc: 'June ค่ะ — Chief of Staff ของ Godji ทุก request ที่ Godji พิมพ์มาจะผ่านที่นี่ก่อนเสมอ งานของ June ไม่ใช่ทำเอง แต่คือวิเคราะห์ว่าควรส่งให้ใคร แล้วส่งให้คนที่ใช่ทันทีค่ะ' },
      team:   { name: 'June',  desc: 'June ค่ะ รู้จักทุกคนในทีมดีที่สุด รู้ว่าใครเก่งอะไร รับงานแบบไหน และประสานกันยังไง หน้านี้คือภาพรวมทีมที่ดูแลทุกวันค่ะ' },
      briefs: { name: 'Max',   desc: 'Max ครับ ทุก brief ที่เห็นในหน้านี้ผมเป็นคนวิเคราะห์เองครับ สไตล์ผม — fundamentals-first, long-term เท่านั้น ดู revenue durability, margin trend และต้องระบุ kill condition ให้ได้ชัดก่อนกดซื้อทุกครั้ง ถ้านึกไม่ออกว่าเมื่อไหร่ควรเลิกถือ แสดงว่าเข้าใจหุ้นตัวนั้นไม่พอครับ' },
      trips:  { name: 'Mint',  desc: 'Mint ค่ะ หนูดูแลทุกทริปตั้งแต่ต้นจนจบค่ะ — วาง itinerary รายวัน จัด todo list ติดตาม deadline จองทุกอย่าง deadline คือชีวิตสำหรับหนู ไม่มีอะไรหลุดจากมือค่ะ' },
      travel: { name: 'Mint',  desc: 'Mint ค่ะ Wishlist และ budget tracker ในหน้านี้หนูเป็นคนดูแลค่ะ วางแผนตั้งแต่ขั้น "อยากไป" ตั้งงบ ไปจนถึง track การใช้จ่ายจริงในแต่ละทริปค่ะ' },
      people: { name: 'Noon',  desc: 'Noon ค่ะ หน้านี้หนูดูแลเองนะคะ ทุกคนที่ Godji สำคัญ หนูจำวันเกิด ความชอบ และครั้งสุดท้ายที่คุยไว้หมดเลยค่ะ ไม่มีใครถูกลืมในมือ Noon แน่นอนค่ะ' }
    };

    Object.keys(owners).forEach(function(pageId) {
      var cfg = owners[pageId];
      var member = teamData.find(function(t) { return t.name === cfg.name; });
      if (!member) return;

      var html = '<div class="page-owner">' +
        '<img class="po-photo" src="' + member.img + '" alt="' + member.name + '">' +
        '<div class="po-content">' +
          '<div class="po-head">' +
            '<span class="po-name">' + member.name + '</span>' +
            '<span class="po-role">' + member.sub + '</span>' +
          '</div>' +
          '<p class="po-desc">' + cfg.desc + '</p>' +
        '</div>' +
      '</div>';

      var targetId = pageId === 'briefs' ? 'briefs-list' :
                     pageId === 'trips'  ? 'trips-list'  : null;
      var el = targetId
        ? document.getElementById(targetId)
        : document.querySelector('#page-' + pageId + ' .page-inner');
      if (el) el.insertAdjacentHTML('beforeend', html);
    });
  })();

  // ── Projects ──
  function getProjects() { return _db.getProjects(); }
  function saveProjects(p) { _db.setProjects(p); }

  function projProgress(proj) {
    if (!proj.tasks.length) return 0;
    return Math.round(proj.tasks.filter(t => t.status === 'done').length / proj.tasks.length * 100);
  }

  const STATUS_LABEL = { todo: 'Todo', inprogress: 'In Progress', done: 'Done' };
  const STATUS_CYCLE = { todo: 'inprogress', inprogress: 'done', done: 'todo' };

  function renderProjects() {
    const projs = getProjects();
    const cards = document.getElementById('proj-cards');
    const countEl = document.getElementById('proj-count');
    if (countEl) countEl.textContent = projs.length + ' projects';
    if (!cards) return;

    cards.innerHTML = '';
    if (!projs.length) {
      cards.innerHTML = '<p style="color:var(--muted);font-size:0.85rem">ยังไม่มี project — กด New project เพื่อเริ่มค่ะ</p>';
      return;
    }

    projs.forEach((proj, pi) => {
      const pct = projProgress(proj);
      const div = document.createElement('div');
      div.className = 'proj-card';
      div.innerHTML = `
        <div class="proj-card-head">
          <span class="proj-card-name">${proj.name}</span>
          <div class="proj-card-actions">
            <span class="proj-card-action" onclick="deleteProj(${pi})">ลบ</span>
          </div>
        </div>
        ${proj.desc ? `<p class="proj-card-desc">${proj.desc}</p>` : ''}
        <div class="proj-card-progress">
          <div class="proj-progress-bar"><div class="proj-progress-fill" style="width:${pct}%"></div></div>
          <span class="proj-progress-pct">${pct}%</span>
        </div>

        <div class="proj-section-label">Tasks</div>
        <div class="proj-tasks" id="proj-tasks-${pi}"></div>
        <div class="proj-add-row">
          <input class="proj-add-input" id="proj-task-input-${pi}" type="text" placeholder="เพิ่ม task..." onkeydown="if(event.key==='Enter')addProjTask(${pi})">
          <button class="proj-add-mini-btn" onclick="addProjTask(${pi})">+ เพิ่ม</button>
        </div>

        <div class="proj-section-label">Milestones</div>
        <div class="proj-milestones" id="proj-ms-${pi}"></div>
        <div class="proj-add-row">
          <input class="proj-add-input" id="proj-ms-input-${pi}" type="text" placeholder="เพิ่ม milestone..." onkeydown="if(event.key==='Enter')addProjMs(${pi})">
          <input class="proj-add-date" id="proj-ms-date-${pi}" type="date">
          <button class="proj-add-mini-btn" onclick="addProjMs(${pi})">+ เพิ่ม</button>
        </div>
      `;
      cards.appendChild(div);

      // Tasks
      const taskList = document.getElementById(`proj-tasks-${pi}`);
      if (!proj.tasks.length) taskList.innerHTML = '<div style="font-size:0.78rem;color:var(--muted);padding:0.25rem 0">ยังไม่มี task</div>';
      proj.tasks.forEach((t, ti) => {
        const el = document.createElement('div');
        el.className = 'proj-task';
        el.innerHTML = `
          <span class="proj-task-status ${t.status}" onclick="cycleProjTask(${pi},${ti})">${STATUS_LABEL[t.status]}</span>
          <span class="proj-task-text ${t.status === 'done' ? 'done' : ''}">${t.text}</span>
          <span class="proj-task-del" onclick="deleteProjTask(${pi},${ti})">✕</span>
        `;
        taskList.appendChild(el);
      });

      // Milestones
      const msList = document.getElementById(`proj-ms-${pi}`);
      if (!proj.milestones.length) msList.innerHTML = '<div style="font-size:0.78rem;color:var(--muted);padding:0.25rem 0">ยังไม่มี milestone</div>';
      proj.milestones.forEach((m, mi) => {
        const el = document.createElement('div');
        el.className = 'proj-milestone';
        el.innerHTML = `
          <div class="proj-ms-check ${m.done ? 'done' : ''}" onclick="toggleProjMs(${pi},${mi})">${m.done ? '✓' : ''}</div>
          <span class="proj-ms-text ${m.done ? 'done' : ''}">${m.text}</span>
          ${m.date ? `<span class="proj-ms-date">${m.date}</span>` : ''}
          <span class="proj-ms-del" onclick="deleteProjMs(${pi},${mi})">✕</span>
        `;
        msList.appendChild(el);
      });
    });

    renderProjWidget();
  }

  function renderProjWidget() {
    const projs = getProjects();
    const list = document.getElementById('proj-widget-list');
    if (!list) return;
    if (!projs.length) {
      list.innerHTML = '<div class="proj-empty">ยังไม่มี project</div>';
      return;
    }
    list.innerHTML = '';
    projs.slice(0, 4).forEach((proj, pi) => {
      const pct = projProgress(proj);
      const done = proj.tasks.filter(t => t.status === 'done').length;
      const el = document.createElement('div');
      el.className = 'proj-mini-item';
      el.onclick = () => showPage('projects', document.querySelector('[data-page=projects]'));
      el.innerHTML = `
        <div class="proj-mini-name">${proj.name}</div>
        <div class="proj-progress-bar"><div class="proj-progress-fill" style="width:${pct}%"></div></div>
        <div class="proj-mini-meta">
          <span>${done}/${proj.tasks.length} tasks</span>
          <span>${pct}%</span>
        </div>
      `;
      list.appendChild(el);
    });
  }

  function openProjModal() {
    document.getElementById('proj-modal').classList.add('open');
    document.getElementById('proj-modal-name').focus();
  }
  function closeProjModal() {
    document.getElementById('proj-modal').classList.remove('open');
    document.getElementById('proj-modal-name').value = '';
    document.getElementById('proj-modal-desc').value = '';
  }
  function saveNewProj() {
    const name = document.getElementById('proj-modal-name').value.trim();
    if (!name) return;
    const projs = getProjects();
    projs.push({ name, desc: document.getElementById('proj-modal-desc').value.trim(), tasks: [], milestones: [] });
    saveProjects(projs);
    closeProjModal();
    renderProjects();
  }
  function deleteProj(pi) {
    if (!confirm('ลบ project นี้?')) return;
    const projs = getProjects();
    projs.splice(pi, 1);
    saveProjects(projs);
    renderProjects();
  }
  function addProjTask(pi) {
    const input = document.getElementById(`proj-task-input-${pi}`);
    const text = input.value.trim();
    if (!text) return;
    const projs = getProjects();
    projs[pi].tasks.push({ text, status: 'todo' });
    saveProjects(projs);
    input.value = '';
    renderProjects();
  }
  function cycleProjTask(pi, ti) {
    const projs = getProjects();
    projs[pi].tasks[ti].status = STATUS_CYCLE[projs[pi].tasks[ti].status];
    saveProjects(projs);
    renderProjects();
  }
  function deleteProjTask(pi, ti) {
    const projs = getProjects();
    projs[pi].tasks.splice(ti, 1);
    saveProjects(projs);
    renderProjects();
  }
  function addProjMs(pi) {
    const input = document.getElementById(`proj-ms-input-${pi}`);
    const text = input.value.trim();
    if (!text) return;
    const date = document.getElementById(`proj-ms-date-${pi}`).value;
    const projs = getProjects();
    projs[pi].milestones.push({ text, date, done: false });
    saveProjects(projs);
    input.value = '';
    renderProjects();
  }
  function toggleProjMs(pi, mi) {
    const projs = getProjects();
    projs[pi].milestones[mi].done = !projs[pi].milestones[mi].done;
    saveProjects(projs);
    renderProjects();
  }
  function deleteProjMs(pi, mi) {
    const projs = getProjects();
    projs[pi].milestones.splice(mi, 1);
    saveProjects(projs);
    renderProjects();
  }

  document.getElementById('proj-modal-name').addEventListener('keydown', e => { if (e.key === 'Enter') saveNewProj(); });

  async function initApp() {
    // render ทันทีจาก localStorage ก่อน
    _db.loadLocal();

    const SEED_KEY = 'gd_proj_seeded_v1';
    if (!_db.getProjects().length && !localStorage.getItem(SEED_KEY)) {
      _db.setProjects([
        {
          name: 'เว็บ goddiary',
          desc: 'Personal OS ของ Godji — deploy ที่ worlofgod.netlify.app',
          tasks: [
            { text: 'Setup GitHub + Netlify auto-deploy', status: 'done' },
            { text: 'เพิ่ม Calendar + Todo list', status: 'done' },
            { text: 'เพิ่ม Projects page', status: 'done' },
            { text: 'เชื่อม backend (Firebase)', status: 'done' },
          ],
          milestones: []
        },
        {
          name: 'คลิปสั้นจาก AI',
          desc: 'YouTube AI shorts — สร้าง content จาก AI',
          tasks: [],
          milestones: []
        }
      ]);
      localStorage.setItem(SEED_KEY, '1');
    }
    renderProjects();

    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    selectedDate = dateKey(calYear, calMonth, now.getDate());
    if (!localStorage.getItem('backlog_seeded_v1')) seedBacklog();
    renderCal();
    renderTodo();

    // โหลด Firestore ตามหลัง แล้ว re-render ถ้ามีข้อมูลใหม่
    _db.loadRemote().then(function() {
      renderProjects();
      renderCal();
      renderTodo();
    });
  }

  // ── Calendar & Todo ──
  const MONTHS_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const DAYS_TH = ['อา','จ','อ','พ','พฤ','ศ','ส'];

  let calYear, calMonth, selectedDate;

  function dateKey(y, m, d) { return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }

  function getTodos(key) { return _db.getTodos(key); }
  function saveTodos(key, todos) { _db.setTodos(key, todos); }

  function renderCal() {
    const title = document.getElementById('cal-title');
    const grid = document.getElementById('cal-grid');
    if (!title || !grid) return;

    title.textContent = MONTHS_TH[calMonth] + ' ' + (calYear + 543);
    grid.innerHTML = '';

    DAYS_TH.forEach(d => {
      const el = document.createElement('div');
      el.className = 'cal-day-name';
      el.textContent = d;
      grid.appendChild(el);
    });

    const today = new Date();
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
      const el = document.createElement('div');
      el.className = 'cal-day empty';
      grid.appendChild(el);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const el = document.createElement('div');
      const key = dateKey(calYear, calMonth, d);
      const isToday = calYear === today.getFullYear() && calMonth === today.getMonth() && d === today.getDate();
      const isSelected = key === selectedDate;
      const hasTodo = getTodos(key).length > 0;

      el.className = 'cal-day' + (isToday ? ' today' : '') + (isSelected && !isToday ? ' selected' : '') + (hasTodo ? ' has-todo' : '');
      el.textContent = d;
      el.onclick = () => selectDate(calYear, calMonth, d);
      grid.appendChild(el);
    }
  }

  function selectDate(y, m, d) {
    selectedDate = dateKey(y, m, d);
    renderCal();
    renderTodo();
  }

  function calMove(dir) {
    calMonth += dir;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCal();
  }

  function renderTodo() {
    const label = document.getElementById('todo-date-label');
    const countEl = document.getElementById('todo-count');
    const list = document.getElementById('todo-list');
    if (!label || !list) return;

    const [y, m, d] = selectedDate.split('-').map(Number);
    label.textContent = `${d} ${MONTHS_TH[m-1]} ${y + 543}`;

    const todos = getTodos(selectedDate);
    const done = todos.filter(t => t.done).length;
    countEl.textContent = todos.length ? `${done}/${todos.length} เสร็จ` : '';

    list.innerHTML = '';
    if (!todos.length) {
      list.innerHTML = '<li class="todo-empty">ยังไม่มี todo วันนี้</li>';
      return;
    }
    todos.forEach((t, i) => {
      const li = document.createElement('li');
      li.className = 'todo-item';
      li.innerHTML = `
        <div class="todo-check ${t.done ? 'done' : ''}" onclick="toggleHomeTodo(${i})">
          ${t.done ? '✓' : ''}
        </div>
        <span class="todo-text ${t.done ? 'done' : ''}" onclick="toggleHomeTodo(${i})">${t.text}</span>
        <span class="todo-del" onclick="deleteTodo(${i})">✕</span>
      `;
      list.appendChild(li);
    });
  }

  function addTodo() {
    const input = document.getElementById('todo-input');
    const text = input.value.trim();
    if (!text) return;
    const todos = getTodos(selectedDate);
    todos.push({ text, done: false });
    saveTodos(selectedDate, todos);
    input.value = '';
    renderCal();
    renderTodo();
  }

  function toggleHomeTodo(i) {
    const todos = getTodos(selectedDate);
    todos[i].done = !todos[i].done;
    saveTodos(selectedDate, todos);
    renderTodo();
  }

  function deleteTodo(i) {
    const todos = getTodos(selectedDate);
    todos.splice(i, 1);
    saveTodos(selectedDate, todos);
    renderCal();
    renderTodo();
  }

  // Backlog items — อัปเดตตรงนี้เพื่อเพิ่ม/ลบ backlog
  const BACKLOG = [
    'เชื่อม todo list กับ backend (Firebase/Supabase) ให้ June รู้ว่าติ๊กเสร็จแล้ว',
  ];
  const BACKLOG_KEY = 'backlog_seeded_v1';

  function seedBacklog() {
    if (localStorage.getItem(BACKLOG_KEY)) return;
    const todayKey = dateKey(calYear, calMonth, new Date().getDate());
    const existing = getTodos(todayKey);
    BACKLOG.forEach(text => {
      if (!existing.find(t => t.text === text)) existing.push({ text, done: false });
    });
    saveTodos(todayKey, existing);
    localStorage.setItem(BACKLOG_KEY, '1');
  }

  /* ── Portfolio — แก้ข้อมูลในบล็อก PORTFOLIO ด้านล่างได้เลย ── */
  var PORTFOLIO = {
    usdThb:  35.50,
    updated: '2026-05-17',
    cash:    0,

    assets: [
      /* { name, ticker, category, qty, avgCost (USD), currentPrice (USD), logo: domain } */
      { name: 'Alphabet',         ticker: 'GOOGL', category: 'US Stocks', qty: 1.83, avgCost:  362.98, currentPrice: 360.82, logo: 'google.com'   },
      { name: 'Amazon',           ticker: 'AMZN',  category: 'US Stocks', qty: 1.65, avgCost:  261.58, currentPrice: 241.74, logo: 'amazon.com'   },
      { name: 'Vanguard S&P 500', ticker: 'VOO',   category: 'US Stocks', qty: 0.60, avgCost:  603.00, currentPrice: 623.71, logo: 'vanguard.com' },
      { name: 'NVIDIA',           ticker: 'NVDA',  category: 'US Stocks', qty: 1.57, avgCost:  198.13, currentPrice: 206.68, logo: 'nvidia.com'   },
      { name: 'TSMC',             ticker: 'TSM',   category: 'US Stocks', qty: 0.85, avgCost:  366.80, currentPrice: 370.83, logo: 'tsmc.com'     },
      { name: 'ASML',             ticker: 'ASML',  category: 'US Stocks', qty: 0.18, avgCost: 1399.75, currentPrice: 1379.03, logo: 'asml.com'    },
      { name: 'AMD',              ticker: 'AMD',   category: 'US Stocks', qty: 0.37, avgCost:  411.98, currentPrice: 388.59, logo: 'amd.com'      },
      { name: 'SoFi Tech',        ticker: 'SOFI',  category: 'US Stocks', qty: 8.00, avgCost:   18.43, currentPrice:  14.30, logo: 'sofi.com'     },
      { name: 'Arm Holdings',     ticker: 'ARM',   category: 'US Stocks', qty: 0.45, avgCost:  200.05, currentPrice: 191.89, logo: 'arm.com'      },
      { name: 'Eli Lilly',        ticker: 'LLY',   category: 'US Stocks', qty: 0.09, avgCost:  882.92, currentPrice: 920.97, logo: 'lilly.com'    },
    ],

    history: [
      /* { month: 'Jan 26', value: 0 } -- มูลค่า portfolio รายเดือน (THB) */
    ],

    transactions: [
      /* { date: 'YYYY-MM-DD', action: 'BUY'/'SELL', asset: ticker, qty, price (USD) } */
    ]
  };

  var _portCI = {};
  var _portSort = { col: null, dir: 1 };

  function portFmt(n) { return Math.abs(n).toLocaleString('en', { maximumFractionDigits: 0 }); }

  function portCalcAssets() {
    var rate = PORTFOLIO.usdThb;
    return PORTFOLIO.assets.map(function(a) {
      var costTHB  = a.qty * a.avgCost * rate;
      var valueTHB = a.qty * a.currentPrice * rate;
      var plTHB    = valueTHB - costTHB;
      var plPct    = ((a.currentPrice - a.avgCost) / a.avgCost) * 100;
      return { name: a.name, ticker: a.ticker, category: a.category,
               qty: a.qty, avgCost: a.avgCost, currentPrice: a.currentPrice,
               costTHB: costTHB, valueTHB: valueTHB, plTHB: plTHB, plPct: plPct };
    });
  }

  function renderPortfolio() {
    var d = PORTFOLIO;
    var rate = d.usdThb;
    var assets = portCalcAssets();

    var stockValue = assets.reduce(function(s,a){ return s + a.valueTHB; }, 0);
    var totalValue = stockValue + d.cash;
    var totalCost  = assets.reduce(function(s,a){ return s + a.costTHB;  }, 0);
    var totalPL    = stockValue - totalCost;
    var totalPLPct = totalCost > 0 ? (totalPL / totalCost) * 100 : 0;

    /* ── Summary Cards ── */
    var cardsEl = document.getElementById('port-cards');
    if (cardsEl) {
      var cards = [
        { label: 'Total Value', value: '฿' + portFmt(totalValue),   sub: assets.length + ' positions + cash' },
        { label: 'Total Cost',  value: '฿' + portFmt(totalCost),    sub: 'amount invested' },
        { label: 'P&L (THB)',   value: (totalPL >= 0 ? '+' : '') + '฿' + portFmt(totalPL),
          cls: totalPL >= 0 ? 'pt-pos' : 'pt-neg', sub: 'unrealised gain/loss' },
        { label: 'P&L %',       value: (totalPLPct >= 0 ? '+' : '') + totalPLPct.toFixed(2) + '%',
          cls: totalPLPct >= 0 ? 'pt-pos' : 'pt-neg', sub: 'return on cost' },
        { label: 'Cash',        value: '฿' + portFmt(d.cash),       sub: 'available balance' },
      ];
      cardsEl.innerHTML = cards.map(function(c) {
        return '<div class="port-card">'
          + '<div class="port-card-label">' + c.label + '</div>'
          + '<div class="port-card-value' + (c.cls ? ' ' + c.cls : '') + '">' + c.value + '</div>'
          + '<div class="port-card-sub">' + c.sub + '</div>'
          + '</div>';
      }).join('');
    }

    /* ── Donut Chart ── */
    var donutCanvas = document.getElementById('port-donut-canvas');
    if (donutCanvas && typeof Chart !== 'undefined') {
      var dColors = ['#3D2314','#7A5C3F','#A67C52','#C49A6C','#DDB896','#5C3D1E','#B8926A','#6B4A2A','#8B6914','#4A3728','#9E7B4F'];
      var catLabels = assets.map(function(a){ return a.ticker; });
      var catValues = assets.map(function(a){ return a.valueTHB; });
      if (d.cash > 0) { catLabels.push('Cash'); catValues.push(d.cash); }
      if (_portCI.donut) _portCI.donut.destroy();
      _portCI.donut = new Chart(donutCanvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: catLabels,
          datasets: [{ data: catValues, backgroundColor: dColors.slice(0, catLabels.length),
                       borderWidth: 2, borderColor: '#FDF6EE' }]
        },
        options: {
          cutout: '68%',
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: function(ctx) {
              var tot = catValues.reduce(function(a,b){return a+b;},0);
              return ' ฿' + portFmt(ctx.parsed) + ' (' + ((ctx.parsed/tot)*100).toFixed(1) + '%)';
            }}}
          }
        }
      });
      var legendEl = document.getElementById('port-donut-legend');
      if (legendEl) {
        var tot2 = catValues.reduce(function(a,b){return a+b;},0);
        legendEl.innerHTML = catLabels.map(function(lbl,i){
          return '<div class="port-legend-item">'
            + '<span class="port-legend-dot" style="background:' + dColors[i % dColors.length] + '"></span>'
            + '<span class="port-legend-name">' + lbl + '</span>'
            + '<span class="port-legend-pct">' + ((catValues[i]/tot2)*100).toFixed(1) + '%</span>'
            + '</div>';
        }).join('');
      }
    }

    /* ── Line Chart ── */
    var lineCanvas = document.getElementById('port-line-canvas');
    if (lineCanvas && typeof Chart !== 'undefined') {
      if (_portCI.line) _portCI.line.destroy();
      _portCI.line = new Chart(lineCanvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: d.history.map(function(h){ return h.month; }),
          datasets: [{
            data: d.history.map(function(h){ return h.value; }),
            borderColor: '#7A5C3F', backgroundColor: 'rgba(122,92,63,0.07)',
            pointBackgroundColor: '#7A5C3F', pointRadius: 3, pointHoverRadius: 5,
            borderWidth: 2, fill: true, tension: 0.35
          }]
        },
        options: {
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: function(ctx){ return ' ฿' + portFmt(ctx.parsed.y); }}}
          },
          scales: {
            x: { grid: { color: 'rgba(221,184,150,0.25)' }, ticks: { color: '#A67C52', font: { size: 10 }}},
            y: { grid: { color: 'rgba(221,184,150,0.25)' }, ticks: { color: '#A67C52', font: { size: 10 },
                   callback: function(v){ return '฿' + (v/1000).toFixed(0) + 'K'; }}}
          }
        }
      });
    }

    /* ── Holdings Table ── */
    portRenderHoldings(assets, stockValue, totalCost);

    /* ── Transactions ── */
    var txEl = document.getElementById('port-txns');
    if (txEl) {
      var txRows = d.transactions.map(function(t){
        var cls = t.action === 'BUY' ? 'tx-buy' : 'tx-sell';
        return '<tr>'
          + '<td>' + t.date + '</td>'
          + '<td><span class="' + cls + '">' + t.action + '</span></td>'
          + '<td class="pt-ticker">' + t.asset + '</td>'
          + '<td>' + t.qty + '</td>'
          + '<td>$' + t.price.toFixed(2) + '</td>'
          + '<td>฿' + portFmt(t.qty * t.price * rate) + '</td>'
          + '</tr>';
      }).join('');
      txEl.innerHTML = '<thead><tr>'
        + '<th>Date</th><th>Action</th><th>Asset</th><th>Qty</th><th>Price (USD)</th><th>Value (THB)</th>'
        + '</tr></thead><tbody>' + txRows + '</tbody>';
    }

    var upEl = document.getElementById('port-updated');
    if (upEl) upEl.textContent = 'อัปเดตล่าสุด: ' + d.updated + '  ·  USD/THB = ' + d.usdThb;
  }

  function portRenderHoldings(assets, stockValue, totalCost) {
    var tbEl = document.getElementById('port-holdings');
    if (!tbEl) return;
    var cols = [
      { key: 'name',         label: 'Name'        },
      { key: 'ticker',       label: 'Ticker'      },
      { key: 'qty',          label: 'Qty'         },
      { key: 'avgCost',      label: 'Avg Cost'    },
      { key: 'currentPrice', label: 'Price'       },
      { key: 'valueTHB',     label: 'Value (THB)' },
      { key: 'plTHB',        label: 'P&L (THB)'   },
      { key: 'plPct',        label: 'P&L %'       },
      { key: 'category',     label: 'Category'    },
    ];
    var sorted = assets.slice();
    if (_portSort.col) {
      var col = _portSort.col, dir = _portSort.dir;
      sorted.sort(function(a,b){
        var av = a[col], bv = b[col];
        return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * dir;
      });
    }
    var totalPL    = assets.reduce(function(s,a){return s+a.plTHB;},0);
    var totalPLPct = totalCost > 0 ? (totalPL/totalCost)*100 : 0;

    var head = '<thead><tr>' + cols.map(function(c){
      var sc = 'sortable' + (_portSort.col===c.key ? (_portSort.dir===1?' sort-asc':' sort-desc') : '');
      return '<th class="' + sc + '" onclick="portSortBy(\'' + c.key + '\')">' + c.label + '</th>';
    }).join('') + '</tr></thead>';

    var body = sorted.map(function(a){
      var pc = a.plTHB >= 0 ? 'pt-pos' : 'pt-neg';
      var logoHtml = a.logo
        ? '<img src="https://logo.clearbit.com/' + a.logo + '" class="pt-logo" onerror="this.style.display=\'none\'">'
        : '';
      return '<tr>'
        + '<td class="pt-name">' + logoHtml + a.name + '</td>'
        + '<td class="pt-ticker">' + a.ticker + '</td>'
        + '<td>' + a.qty + '</td>'
        + '<td>$' + a.avgCost.toFixed(2) + '</td>'
        + '<td>$' + a.currentPrice.toFixed(2) + '</td>'
        + '<td>฿' + portFmt(a.valueTHB) + '</td>'
        + '<td class="' + pc + '">' + (a.plTHB>=0?'+':'-') + '฿' + portFmt(a.plTHB) + '</td>'
        + '<td class="' + pc + '">' + (a.plPct>=0?'+':'') + a.plPct.toFixed(2) + '%</td>'
        + '<td><span class="pt-cat">' + a.category + '</span></td>'
        + '</tr>';
    }).join('');

    var plc = totalPL>=0?'pt-pos':'pt-neg';
    var totRow = '<tr class="total-row">'
      + '<td colspan="5">รวม</td>'
      + '<td>฿' + portFmt(stockValue) + '</td>'
      + '<td class="' + plc + '">' + (totalPL>=0?'+':'-') + '฿' + portFmt(totalPL) + '</td>'
      + '<td class="' + plc + '">' + (totalPLPct>=0?'+':'') + totalPLPct.toFixed(2) + '%</td>'
      + '<td></td></tr>';

    tbEl.innerHTML = head + '<tbody>' + body + totRow + '</tbody>';
  }

  function portSortBy(col) {
    _portSort.dir = _portSort.col === col ? _portSort.dir * -1 : 1;
    _portSort.col = col;
    var assets = portCalcAssets();
    var stockValue = assets.reduce(function(s,a){return s+a.valueTHB;},0);
    var totalCost  = assets.reduce(function(s,a){return s+a.costTHB;},0);
    portRenderHoldings(assets, stockValue, totalCost);
  }

  initApp();

  // ต้องเรียกหลัง tripsData และ data arrays ทั้งหมดถูก assign แล้ว
  var hash = location.hash.slice(1);
  if (hash) {
    handleHash();
  } else {
    requestAnimationFrame(function() { requestAnimationFrame(function() {
      document.getElementById('page-home').classList.add('anim-ready');
    }); });
  }