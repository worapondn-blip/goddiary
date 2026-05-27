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
  let _isAllowed   = false;

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

  function showReadOnlyBanner(show) {
    var el = document.getElementById('readonly-banner');
    if (el) el.style.display = show ? 'block' : 'none';
  }

  _auth.onAuthStateChanged(async function(user) {
    _currentUser = user;
    _isAllowed   = false;
    var btn = document.getElementById('auth-btn');
    if (!btn) return;
    if (user) {
      try {
        var cfg = await _fs.collection('shared').doc('config').get();
        var allowed = cfg.exists ? (cfg.data().allowedEmails || []) : [];
        _isAllowed = allowed.includes(user.email);
      } catch(e) { _isAllowed = false; }

      btn.textContent = '● ' + (user.displayName ? user.displayName.split(' ')[0] : user.email);
      btn.title = 'Sign out';
      btn.onclick = function() { openAuthModal('signout-modal'); };
      showReadOnlyBanner(!_isAllowed);

      _db.loadRemote().then(function() {
        renderProjects(); renderCal(); renderTodo();
      });

      if (_isAllowed) {
        _db.ensureUserProfile(user).then(function() { renderPeople(); });
      } else {
        renderPeople();
      }
    } else {
      btn.textContent = 'Sign in';
      btn.title = '';
      btn.onclick = signIn;
      showReadOnlyBanner(false);
    }
  });

  /* ── DB Layer (Firestore + localStorage fallback) ── */
  var _db = (function() {
    var _c = { projects: null, todos: null, travel: null, trip_todos: null, trip_companions: null, friends_extra: null };
    function ref(n) {
      if (!_currentUser) return null;
      return _fs.collection('users').doc(_currentUser.uid).collection('data').doc(n);
    }
    function sharedRef(n) { return _fs.collection('shared').doc(n); }
    function lsKey(k) { return _currentUser ? k + '_u_' + _currentUser.uid : k; }
    var _syncTimer;
    function showSync(state) {
      var el = document.getElementById('sync-status');
      if (!el) return;
      clearTimeout(_syncTimer);
      var labels = { saving: '↑ กำลัง sync…', saved: '✓ sync แล้ว', error: '⚠ sync ล้มเหลว', local: '○ เก็บในเครื่อง' };
      el.className = 'sync-status ' + state;
      el.textContent = labels[state] || '';
      if (state === 'saved') _syncTimer = setTimeout(function() { el.textContent = ''; el.className = 'sync-status'; }, 3000);
    }
    function write(n, data) {
      if (!_currentUser) { showSync('local'); return; }
      showSync('saving');
      ref(n).set(data)
        .then(function() { showSync('saved'); })
        .catch(function(e) { console.warn('Firestore write:', e); showSync('error'); });
    }
    function lsGet(key, def) {
      try { return JSON.parse(localStorage.getItem(key) || 'null') || def; } catch { return def; }
    }
    function lsTodos() {
      var uid = _currentUser ? _currentUser.uid : '';
      var prefix = uid ? 'todos_u_' + uid + '_' : 'todos_';
      var r = {};
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.startsWith(prefix)) { try { r[k.slice(prefix.length)] = JSON.parse(localStorage.getItem(k) || '[]'); } catch {} }
      }
      return r;
    }
    function lsTripTodos() {
      var uid = _currentUser ? _currentUser.uid : '';
      var prefix = uid ? 'godji_todos_u_' + uid + '_' : 'godji_todos_';
      var r = {};
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.startsWith(prefix)) { try { r[k.slice(prefix.length)] = JSON.parse(localStorage.getItem(k) || '{}'); } catch {} }
      }
      return r;
    }
    function loadLocal() {
      _c.projects        = lsGet(lsKey('gd_projects'), []);
      _c.todos           = lsTodos();
      _c.travel          = lsGet('gd_travel_shared', { wishlist:[], visited:[], budgets:[] });
      _c.trip_todos      = lsTripTodos();
      _c.trip_companions = lsGet(lsKey('gd_trip_companions'), {});
      _c.friends_extra   = lsGet(lsKey('gd_friends_extra'), []);
    }
    async function loadRemote() {
      try {
        // travel โหลดจาก shared collection (ไม่แยก user)
        var travelSnap = await sharedRef('travel').get();
        _c.travel = travelSnap.exists ? travelSnap.data() : _c.travel;
        try { localStorage.setItem('gd_travel_shared', JSON.stringify(_c.travel)); } catch {}

        var names = ['projects','todos','trip_todos','trip_companions'];
        var ss = await Promise.all(names.map(function(n) { return ref(n).get(); }));

        // ครั้งแรก — ถ้าไม่มีข้อมูลใน user path เลย ให้ migrate จาก legacy path
        var hasAnyData = ss.some(function(s) { return s.exists; });
        if (!hasAnyData) {
          var legacyRef = function(n) { return _fs.collection('app').doc(n); };
          var ls = await Promise.all(names.map(function(n) { return legacyRef(n).get(); }));
          var batch = _fs.batch();
          ls.forEach(function(s, i) { if (s.exists) batch.set(ref(names[i]), s.data()); });
          await batch.commit();
          ss = await Promise.all(names.map(function(n) { return ref(n).get(); }));
        }

        _c.projects        = ss[0].exists ? (ss[0].data().items || []) : _c.projects;
        _c.todos           = ss[1].exists ? (ss[1].data().data  || {}) : _c.todos;
        _c.trip_todos      = ss[2].exists ? (ss[2].data().data  || {}) : _c.trip_todos;
        _c.trip_companions = ss[3].exists ? (ss[3].data().data  || {}) : _c.trip_companions;

        var fss = await ref('friends_extra').get();
        if (!fss.exists) {
          var lf = await _fs.collection('app').doc('friends_extra').get();
          if (lf.exists) { await ref('friends_extra').set(lf.data()); fss = await ref('friends_extra').get(); }
        }
        _c.friends_extra = fss.exists ? (fss.data().data || []) : _c.friends_extra;
      } catch(e) {
        console.warn('Firestore unavailable, using localStorage:', e);
      }
    }
    return {
      loadLocal:    loadLocal,
      loadRemote:   loadRemote,
      getProjects:  function()      { return _c.projects || []; },
      setProjects:  function(v)     { _c.projects = v; try { localStorage.setItem(lsKey('gd_projects'), JSON.stringify(v)); } catch {} write('projects', { items: v }); },
      getTodos:     function(k)     { return (_c.todos || {})[k] || []; },
      setTodos:     function(k, v)  {
        if (!_c.todos) _c.todos = {};
        _c.todos[k] = v;
        var uid = _currentUser ? _currentUser.uid : '';
        try { localStorage.setItem(uid ? 'todos_u_' + uid + '_' + k : 'todos_' + k, JSON.stringify(v)); } catch {}
        write('todos', { data: _c.todos });
      },
      getTravel:    function()      { return _c.travel || { wishlist:[], visited:[], budgets:[] }; },
      setTravel:    function(v)     {
        _c.travel = v;
        try { localStorage.setItem('gd_travel_shared', JSON.stringify(v)); } catch {}
        showSync('saving');
        sharedRef('travel').set(v)
          .then(function() { showSync('saved'); })
          .catch(function(e) { console.warn('Firestore write (travel):', e); showSync('error'); });
      },
      getComments: function(tripId, cb) {
        return _fs.collection('trip_comments').doc(tripId).collection('items')
          .orderBy('ts').onSnapshot(function(snap) {
            cb(snap.docs.map(function(d) { return Object.assign({ _id: d.id }, d.data()); }));
          }, function(e) { console.warn('comments listener:', e); cb([]); });
      },
      addComment: function(tripId, text) {
        if (!_currentUser) return Promise.reject('not logged in');
        return _fs.collection('trip_comments').doc(tripId).collection('items').add({
          uid:    _currentUser.uid,
          name:   _currentUser.displayName || 'Anonymous',
          avatar: _currentUser.photoURL || '',
          text:   text,
          ts:     firebase.firestore.FieldValue.serverTimestamp()
        });
      },
      deleteComment: function(tripId, commentId) {
        return _fs.collection('trip_comments').doc(tripId).collection('items').doc(commentId).delete();
      },
      getTripTodos: function(id)    { return (_c.trip_todos || {})[id] || {}; },
      setTripTodos: function(id, v) {
        if (!_c.trip_todos) _c.trip_todos = {};
        _c.trip_todos[id] = v;
        var uid = _currentUser ? _currentUser.uid : '';
        try { localStorage.setItem(uid ? 'godji_todos_u_' + uid + '_' + id : 'godji_todos_' + id, JSON.stringify(v)); } catch {}
        write('trip_todos', { data: _c.trip_todos });
      },
      getTripCompanions: function(id) {
        var ov = (_c.trip_companions || {})[id];
        if (ov) return ov;
        var trip = tripsData.find(function(t) { return t.id === id; });
        return trip ? (trip.companionIds || []) : [];
      },
      setTripCompanions: function(id, ids) {
        if (!_c.trip_companions) _c.trip_companions = {};
        _c.trip_companions[id] = ids;
        try { localStorage.setItem(lsKey('gd_trip_companions'), JSON.stringify(_c.trip_companions)); } catch {}
        write('trip_companions', { data: _c.trip_companions });
      },
      getFriendsAll: function() {
        return friendsData.concat(_c.friends_extra || []);
      },
      addFriend: function(name) {
        if (!_c.friends_extra) _c.friends_extra = [];
        var f = { id: 'ex_' + Date.now(), name: name.trim(), img: '', fb: '' };
        _c.friends_extra.push(f);
        try { localStorage.setItem(lsKey('gd_friends_extra'), JSON.stringify(_c.friends_extra)); } catch {}
        write('friends_extra', { data: _c.friends_extra });
        return f;
      },
      profileRef: function(uid) {
        return _fs.collection('shared').doc('user_profiles').collection('profiles').doc(uid);
      },
      ensureUserProfile: async function(user) {
        var r = this.profileRef(user.uid);
        var snap = await r.get();
        if (!snap.exists) {
          await r.set({
            uid:            user.uid,
            email:          user.email,
            name:           user.displayName || user.email,
            img:            user.photoURL || '',
            bio:            '',
            linkedFriendId: '',
            createdAt:      firebase.firestore.FieldValue.serverTimestamp()
          });
        }
      },
      getProfiles: async function() {
        try {
          var snap = await _fs.collection('shared').doc('user_profiles').collection('profiles').get();
          return snap.docs.map(function(d) { return d.data(); });
        } catch(e) { return []; }
      },
      saveProfile: function(uid, data) {
        return this.profileRef(uid).update(data);
      }
    };
  })();

  /* ── School ── */
  function schoolKey() { return 'gd_school_' + (_currentUser ? _currentUser.uid : 'guest'); }
  function schoolGetProgress() {
    try { return JSON.parse(localStorage.getItem(schoolKey())) || { completed: [], quiz_scores: {} }; } catch(e) { return { completed: [], quiz_scores: {} }; }
  }
  function schoolSaveProgress(p) {
    try { localStorage.setItem(schoolKey(), JSON.stringify(p)); } catch(e) {}
  }
  function schoolMarkComplete(lessonId, score) {
    var p = schoolGetProgress();
    if (!p.completed.includes(lessonId)) p.completed.push(lessonId);
    p.quiz_scores[lessonId] = score;
    schoolSaveProgress(p);
  }

  var SCHOOL_CURRICULUM = [
    { moduleId: 0, levelLabel: 'ระดับ 1', levelColor: 'green', moduleTitle: 'รู้จักการลงทุน', lessons: [
      { id: '0-1', title: 'ทำไมต้องลงทุน?', icon: 'trend-up',
        desc: 'เงินเฟ้อกินค่าเงิน ออมทรัพย์อย่างเดียวไม่พอ',
        tags: ['concept', 'motivation'],
        sections: [
          { type: 'concept', heading: 'แนวคิด', body: '<p><strong>เงินเฟ้อ (Inflation)</strong> คืออัตราที่ราคาสินค้าเพิ่มขึ้นทุกปี ประเทศไทยเฉลี่ย ~2–3%/ปี — แปลว่าเงิน 100 บาทวันนี้ ปีหน้ามีมูลค่าซื้อของได้แค่ ~97–98 บาท</p><ul><li>ดอกเบี้ยออมทรัพย์ไทยปัจจุบัน ~0.5–1.5%/ปี</li><li>เงินเฟ้อ 3% − ดอกเบี้ย 1% = มูลค่าจริงลดลง 2%/ปีโดยไม่ทำอะไร</li><li>ลงทุนอย่างถูกต้อง = เอาชนะเงินเฟ้อ + สร้างความมั่งคั่งระยะยาว</li></ul>' },
          { type: 'example', heading: 'ตัวอย่าง — เงิน 10,000 บาทใน 10 ปี', body: '<p>ฝากออมทรัพย์ 1%/ปี → <strong>11,046 บาท</strong><br>ลงทุน S&P 500 เฉลี่ย 10%/ปี → <strong>25,937 บาท</strong></p><p>ส่วนต่าง: <strong>+14,891 บาท</strong> — จากการไม่ทำอะไรเพิ่มเลย แค่เปลี่ยนที่วางเงิน</p>' },
          { type: 'takeaway', heading: 'Key Takeaway', body: '<p><strong>ไม่ลงทุน ≠ ปลอดภัย</strong> — เงินที่นอนในบัญชีกำลังถูกเงินเฟ้อกัดกินทุกวัน การลงทุนคือการทำให้เงินทำงานแทนคุณ</p>' }
        ],
        quiz: [
          { q: 'เงินเฟ้อ (Inflation) คืออะไร?', options: ['ดอกเบี้ยเงินกู้ที่เพิ่มขึ้น', 'อัตราที่ราคาสินค้าและบริการเพิ่มขึ้นตามเวลา', 'ภาษีเงินได้ประจำปี', 'อัตราแลกเปลี่ยน'], correct: 1 },
          { q: 'ถ้าเงินเฟ้อ 3% และดอกเบี้ยออมทรัพย์ 1% มูลค่าที่แท้จริงเปลี่ยนอย่างไร?', options: ['เพิ่มขึ้น 2% ต่อปี', 'ลดลง 2% ต่อปี', 'ไม่เปลี่ยน', 'เพิ่มขึ้น 4% ต่อปี'], correct: 1 },
          { q: 'ข้อใดถูกต้องที่สุดเกี่ยวกับการ "ไม่ลงทุน"?', options: ['ปลอดภัยที่สุด เพราะไม่มีความเสี่ยง', 'เป็นความเสี่ยงชนิดหนึ่ง เพราะเงินเสื่อมมูลค่าจากเงินเฟ้อ', 'ดีกว่าลงทุน ถ้าตลาดผันผวน', 'ไม่มีผลอะไรในระยะยาว'], correct: 1 }
        ]
      },
      { id: '0-2', title: 'ตั้งเป้าหมายการเงิน', icon: 'target',
        desc: 'เป้าหมายชัด มีกองทุนฉุกเฉินก่อน แล้วค่อยลงทุน',
        tags: ['planning'],
        sections: [
          { type: 'concept', heading: 'แนวคิด', body: '<p>ก่อนลงทุน ต้องตอบ 2 คำถามให้ได้:<br>① <strong>เป้าหมายคืออะไร?</strong> — เงินเท่าไหร่ ภายในกี่ปี?<br>② <strong>กองทุนฉุกเฉินพร้อมหรือยัง?</strong> — ค่าใช้จ่าย 3–6 เดือนในบัญชีที่แตะได้ทันที</p><p>ลำดับ: <strong>กองทุนฉุกเฉิน → จ่ายหนี้ดอกเบี้ยสูง → ลงทุนระยะยาว</strong></p><ul><li>เป้าหมายระยะสั้น (&lt;3 ปี) → ไม่ควรลงหุ้น</li><li>เป้าหมายระยะยาว (3+ ปี) → ตลาดหุ้น historical เฉลี่ย 10%/ปี</li></ul>' },
          { type: 'example', heading: 'ตัวอย่าง — วางแผนเป้าหมาย', body: '<p>🎯 <strong>เงินล้านก่อน 30</strong> = 6 ปี → เหมาะกับหุ้น<br>🎯 <strong>ชำระหนี้ดอกเบี้ยสูง</strong> = 2–3 ปี → ผสม<br>🎯 <strong>ทริปต่างประเทศ</strong> = &lt;1 ปี → เงินสด/ออมทรัพย์</p><p>แบ่งเงินออมตามเป้าหมาย ไม่ใช่ลงทุนทั้งหมดในหุ้น</p>' },
          { type: 'takeaway', heading: 'Key Takeaway', body: '<p><strong>เป้าหมายชัด → กลยุทธ์ถูก</strong> ลงทุนผิดประเภทกับระยะเวลา = เสี่ยงสูงโดยไม่จำเป็น</p>' }
        ],
        quiz: [
          { q: 'กองทุนฉุกเฉิน (Emergency Fund) ควรมีเท่าไหร่?', options: ['1 เดือนของรายได้', 'ค่าใช้จ่าย 3–6 เดือน', 'เงินออม 1 ปีเต็ม', 'ไม่จำเป็น ถ้ามีประกัน'], correct: 1 },
          { q: 'เป้าหมายระยะสั้น (1–2 ปี) ควรใช้ instrument ไหน?', options: ['ลงทุนในหุ้นเต็มที่', 'กองทุนรวมหุ้น 100%', 'เงินสดหรือตราสารหนี้ระยะสั้น', 'Crypto'], correct: 2 },
          { q: 'ลำดับที่ถูกต้องก่อนลงทุนหุ้นคือ?', options: ['ลงทุนหุ้นก่อน แล้วค่อยสร้างกองทุนฉุกเฉิน', 'กองทุนฉุกเฉิน → หนี้ดอกเบี้ยสูง → ลงทุนระยะยาว', 'จ่ายหนี้ทั้งหมดก่อน ค่อยลงทุน', 'ทำพร้อมกันได้เลย'], correct: 1 }
        ]
      },
      { id: '0-3', title: 'ความเสี่ยง vs ผลตอบแทน', icon: 'scales',
        desc: 'ความเสี่ยงรับได้ (risk profile) สำคัญกว่าการเลือกหุ้น',
        tags: ['concept'],
        sections: [
          { type: 'concept', heading: 'แนวคิด', body: '<p>กฎเหล็กการลงทุน: <strong>ผลตอบแทนสูงขึ้น = ความเสี่ยงสูงขึ้นเสมอ</strong></p><ul><li><strong>Risk Profile</strong> = ระดับความเสี่ยงที่รับได้โดยไม่ตัดสินใจผิดพลาด</li><li>ปัจจัย: อายุ, เวลาลงทุน, สภาพการเงิน, นิสัยส่วนตัว</li><li>คนอายุน้อย = รับความเสี่ยงได้สูงกว่า เพราะมีเวลา recover</li></ul><p>📉 เงินฝาก 1–2%/ปี &nbsp; 📊 พันธบัตร 3–5%/ปี &nbsp; 📈 หุ้น ~10%/ปี (ผันผวนสูง)</p>' },
          { type: 'example', heading: 'ตัวอย่าง — S&P 500 ปี 2008 vs 2024', body: '<p>S&P 500 ปี 2008: <strong>−38%</strong> (วิกฤต Subprime)<br>S&P 500 ปี 2009: <strong>+26%</strong> (ฟื้นตัว)<br>S&P 500 ปี 2024: <strong>+25%</strong></p><p>คนที่ขาย panic ปี 2008 ขาดทุนจริง คนที่ถือรอดได้กำไรทบต้น ความเสี่ยงที่ควบคุมไม่ได้คือ <em>ตัวเอง</em> ไม่ใช่ตลาด</p>' },
          { type: 'takeaway', heading: 'Key Takeaway', body: '<p><strong>รู้ risk profile ตัวเองก่อนลงทุน</strong> ถ้ารับการลดลง 30% ไม่ได้โดยไม่ panic ขาย → อย่าลงหุ้น 100%</p>' }
        ],
        quiz: [
          { q: 'Risk Profile คืออะไร?', options: ['อัตราผลตอบแทนที่คาดหวัง', 'ระดับความเสี่ยงที่นักลงทุนรับได้โดยไม่ตัดสินใจผิดพลาด', 'จำนวนหุ้นในพอร์ต', 'P/E Ratio ของพอร์ต'], correct: 1 },
          { q: 'นักลงทุนอายุน้อยมักมี risk profile แบบไหน?', options: ['ต่ำกว่า เพราะประสบการณ์น้อย', 'สูงกว่า เพราะมีเวลา recover จากความผันผวน', 'เหมือนกันทุกคน', 'ขึ้นอยู่กับเงินเดือนอย่างเดียว'], correct: 1 },
          { q: 'S&P 500 ลง 38% ปี 2008 แต่คนที่ถือต่อได้อะไร?', options: ['ขาดทุนถาวร', 'ได้กำไรทบต้นจากการฟื้นตัวในปีถัดๆ มา', 'ได้เงินปันผลพิเศษ', 'ไม่มีผลอะไร'], correct: 1 }
        ]
      },
      { id: '0-4', title: 'ภาพรวมสินทรัพย์', icon: 'squares-four',
        desc: 'หุ้น พันธบัตร กองทุน อสังหาฯ — เลือกอะไรเหมาะกับใคร',
        tags: ['overview'],
        sections: [
          { type: 'concept', heading: 'แนวคิด', body: '<p>4 สินทรัพย์หลัก:</p><ul><li><strong>หุ้น (Stocks)</strong> — เป็นเจ้าของบริษัท ผลตอบแทนสูง ความเสี่ยงสูง เหมาะระยะยาว</li><li><strong>พันธบัตร (Bonds)</strong> — กู้ยืมให้รัฐ/บริษัท ดอกเบี้ยสม่ำเสมอ ความเสี่ยงต่ำ</li><li><strong>กองทุนรวม / ETF</strong> — รวมเงินหลายคน กระจายความเสี่ยงอัตโนมัติ เริ่มต้นง่าย</li><li><strong>อสังหาริมทรัพย์</strong> — ทรัพย์สินจริง ค่าเช่า + มูลค่าเพิ่ม ต้องใช้เงินก้อนใหญ่</li></ul>' },
          { type: 'example', heading: 'ตัวอย่าง — เปรียบเทียบ 10 ปี', body: '<p>เงินต้น 100,000 บาท × 10 ปี:<br>💵 ออมทรัพย์ 1%: <strong>110,462 บาท</strong><br>📜 พันธบัตร 4%: <strong>148,024 บาท</strong><br>📊 ETF S&P 500 10%: <strong>259,374 บาท</strong></p><p>นักลงทุนระยะยาวเลือกหุ้น US เป็น core เพราะ time horizon 6+ ปี และ savings rate สูงพอรับความผันผวน</p>' },
          { type: 'takeaway', heading: 'Key Takeaway', body: '<p><strong>ไม่มีสินทรัพย์ใด "ดีที่สุด" เสมอ</strong> — เลือกตาม risk profile, time horizon, และเงินที่มี กระจาย asset class ช่วยลดความผันผวนรวม</p>' }
        ],
        quiz: [
          { q: 'สินทรัพย์ใดเหมาะกับนักลงทุนที่ต้องการรายได้สม่ำเสมอและความเสี่ยงต่ำ?', options: ['Growth stocks', 'Crypto', 'พันธบัตรรัฐบาล', 'Startup equity'], correct: 2 },
          { q: 'ETF คืออะไร?', options: ['หุ้นของบริษัทเดียว', 'กองทุนที่รวมหลาย asset ซื้อขายได้บนตลาดหุ้น', 'พันธบัตรรัฐบาล', 'บัญชีออมทรัพย์พิเศษ'], correct: 1 },
          { q: 'นักลงทุนที่มี time horizon 6+ ปีและ savings rate สูง ควรเลือก asset ไหนเป็น core?', options: ['หุ้น US ไม่มีภาษี', 'หุ้น US / Global ETF เพราะ time horizon นานพอรับความผันผวน', 'หุ้น US ราคาถูกกว่าไทย', 'หุ้นไทยไม่มีโบรกเกอร์'], correct: 1 }
        ]
      }
    ]},
    { moduleId: 1, levelLabel: 'ระดับ 2', levelColor: 'amber', moduleTitle: 'พื้นฐานหุ้น', lessons: [
      {
        id: '1-1', title: 'หุ้นคืออะไร?', icon: 'chart-line-up',
        desc: 'หุ้นคือความเป็นเจ้าของ ไม่ใช่แค่ตัวเลข',
        tags: ['concept', 'เริ่มต้น'],
        sections: [
          { type: 'concept', heading: 'แนวคิด', body: '<p>เมื่อบริษัทต้องการระดมทุน สามารถออก <strong>หุ้น (Stock / Share)</strong> ขายให้สาธารณะ ผู้ที่ซื้อหุ้นคือ <strong>เจ้าของบริษัทส่วนหนึ่ง</strong> — มีสิทธิ์รับผลกำไร (dividend) และมูลค่าหุ้นเพิ่มขึ้นหากบริษัทเติบโต</p><ul><li>ราคาหุ้นขึ้นลงตามอุปสงค์อุปทานในตลาด</li><li>ตลาดหุ้น US ใหญ่ที่สุดในโลก — NYSE + NASDAQ รวม market cap ~$50+ trillion</li><li>หุ้น ≠ การพนัน ถ้าเราซื้อเพราะเข้าใจธุรกิจ</li></ul>' },
          { type: 'example', heading: 'ตัวอย่างจริง — GOOGL', body: '<p><span class="ticker-tag">GOOGL</span> (Alphabet) มีหุ้นหมุนเวียน ~12 พันล้านหน่วย ซื้อ 1 หุ้น = เป็นเจ้าของประมาณ <strong>1 ใน 12 พันล้าน</strong> ของ Alphabet ซึ่งครอบครอง Google Search, YouTube, Google Cloud และ Waymo</p><p>มูลค่าบริษัท (Market Cap) ~$4.3 trillion USD — ใหญ่กว่า GDP ของหลายประเทศรวมกัน</p>' },
          { type: 'takeaway', heading: 'Key Takeaway', body: '<p><strong>หุ้น = ความเป็นเจ้าของธุรกิจ</strong> ไม่ใช่แค่ตัวเลขที่ขึ้นลง การซื้อหุ้นควรถามว่า "อยากเป็นเจ้าของธุรกิจนี้ไหม?" ไม่ใช่ "ราคาจะขึ้นพรุ่งนี้ไหม?"</p>' }
        ],
        quiz: [
          { q: 'การซื้อหุ้น 1 หน่วยหมายความว่าอะไร?', options: ['ซื้อหนี้ของบริษัท', 'เป็นเจ้าของส่วนหนึ่งของบริษัท', 'กู้เงินให้บริษัท', 'รับประกันผลตอบแทน'], correct: 1 },
          { q: 'ราคาหุ้นถูกกำหนดจากอะไรเป็นหลัก?', options: ['รัฐบาลกำหนด', 'อุปสงค์อุปทานในตลาด', 'CEO ของบริษัทกำหนด', 'ธนาคารกลาง'], correct: 1 },
          { q: 'ตลาดหุ้น US หลักมี 2 แห่งคือ?', options: ['LSE + TSX', 'NYSE + NASDAQ', 'SGX + ASX', 'HKEX + SSE'], correct: 1 }
        ]
      },
      {
        id: '1-2', title: 'วิธีอ่านราคาหุ้นเบื้องต้น', icon: 'chart-bar',
        desc: 'อ่าน price, market cap, 52W range ให้เป็น',
        tags: ['หุ้น', 'basics'],
        sections: [
          { type: 'concept', heading: 'แนวคิด', body: '<p>เมื่อดูหุ้น ตัวเลขสำคัญที่ต้องอ่านเป็น:</p><ul><li><strong>Price</strong> — ราคาล่าสุด ณ ตลาดเปิด</li><li><strong>Market Cap</strong> = Price × Shares Outstanding = มูลค่าบริษัทรวม</li><li><strong>52W High / Low</strong> — ราคาสูงสุด/ต่ำสุดใน 1 ปี บอก range ความผันผวน</li><li><strong>Volume</strong> — จำนวนหุ้นที่เทรดวันนี้ บอกสภาพคล่อง</li></ul>' },
          { type: 'example', heading: 'ตัวอย่างจริง — NVDA vs VOO', body: '<p><span class="ticker-tag">NVDA</span> ราคา ~$206/หุ้น, 52W range $86–$220, market cap ~$5 trillion<br><span class="ticker-tag">VOO</span> (S&P 500 ETF) ราคา ~$623/หุ้น — แพงกว่า NVDA แต่ market cap เปรียบกันไม่ได้เพราะเป็น ETF</p><p><em>บทเรียน:</em> ราคาเดี่ยวไม่บอกว่าถูกหรือแพง VOO ราคาสูงกว่า NVDA แต่ไม่ได้แปลว่า "แพงกว่า" ในแง่มูลค่า</p>' },
          { type: 'takeaway', heading: 'Key Takeaway', body: '<p>ดูราคาควบคู่กับ <strong>Market Cap</strong> เสมอ ราคาต่อหุ้นอย่างเดียวไม่มีความหมาย — Apple $230/หุ้น vs Berkshire $700,000/หุ้น ไม่ได้บอกว่า Apple ถูกกว่า</p>' }
        ],
        quiz: [
          { q: 'Market Cap คำนวณอย่างไร?', options: ['Revenue × Profit margin', 'Price × Shares Outstanding', 'Debt ÷ Equity', 'EPS × P/E Ratio'], correct: 1 },
          { q: 'NVDA ราคา $206 หมายความว่า NVDA แพงกว่าหุ้น $20 หรือไม่?', options: ['ใช่ เสมอ', 'ไม่ใช่ ต้องดู Market Cap และ Fundamentals', 'ใช่ ถ้า Volume สูง', 'ใช่ เพราะ 52W High สูง'], correct: 1 },
          { q: 'Volume หุ้นบอกอะไร?', options: ['กำไรต่อหุ้น', 'จำนวนหุ้นที่เทรดในวันนั้น (สภาพคล่อง)', 'ราคาเปิดตลาด', 'อัตราการจ่ายปันผล'], correct: 1 },
          { q: '52-Week Low บอกอะไร?', options: ['กำไรต่ำสุดของบริษัทปีนี้', 'ราคาต่ำสุดที่หุ้นเคยซื้อขายใน 1 ปีที่ผ่านมา', 'มูลค่าขั้นต่ำของบริษัท', 'อัตราเงินปันผลต่ำสุด'], correct: 1 }
        ]
      },
      {
        id: '1-3', title: 'Buy & Hold คืออะไร?', icon: 'hourglass',
        desc: 'ถือยาว compound ทำงานให้คุณเอง',
        tags: ['strategy', 'หุ้น'],
        sections: [
          { type: 'concept', heading: 'แนวคิด', body: '<p><strong>Buy & Hold</strong> = ซื้อหุ้นในบริษัทที่เชื่อมั่น แล้วถือระยะยาว 3+ ปี ไม่สนใจความผันผวนระยะสั้น</p><ul><li><strong>vs Trading</strong> — trader ซื้อ-ขายถี่ หวังกำไรระยะสั้น ต้องเสียค่า commission + ภาษี + เวลา</li><li>ผลตอบแทน S&P 500 เฉลี่ย ~10%/ปี แต่ถ้าพลาดวัน best 20 วันใน 20 ปี เหลือแค่ ~2%</li><li>Compound growth: $100k × (1.10)^10 = $259k โดยไม่ต้องทำอะไร</li></ul>' },
          { type: 'example', heading: 'ตัวอย่าง — Buy & Hold ระยะยาว', body: '<p><span class="ticker-tag">AMZN</span> ถ้าซื้อ $100 ในปี 2012 → ปัจจุบัน ~$2,000+ (x20 ใน 12 ปี)</p><p>นักลงทุนที่มีงานประจำมักเลือก Buy & Hold เพราะไม่มีเวลา trade ทุกวัน และ fundamentals ของหุ้นที่เลือกยังแข็งแกร่ง</p>' },
          { type: 'takeaway', heading: 'Key Takeaway', body: '<p><strong>"Time in the market beats timing the market"</strong> — อยู่ในตลาดนานกว่าสำคัญกว่าพยายามจับจังหวะ เลือกบริษัทดี ถือนาน ไม่แตะถ้าไม่มี kill condition</p>' }
        ],
        quiz: [
          { q: 'Buy & Hold หมายถึงอะไร?', options: ['ซื้อแล้วขายวันเดียวกัน', 'ซื้อแล้วถือระยะยาว 3+ ปี', 'ซื้อทุกวันจันทร์ขายทุกวันศุกร์', 'ซื้อตอนราคาต่ำขายตอนสูงทุกเดือน'], correct: 1 },
          { q: 'ข้อดีหลักของ Buy & Hold เมื่อเทียบกับ Trading คืออะไร?', options: ['ได้กำไรแน่นอนทุกปี', 'ประหยัดค่า commission และภาษี + ใช้ Compound growth', 'ไม่ต้องวิเคราะห์หุ้นเลย', 'ราคาหุ้นไม่ลดเลย'], correct: 1 },
          { q: '$100,000 ที่ผลตอบแทน 10%/ปี จะเป็นเท่าไรใน 10 ปี?', options: ['$200,000', '$259,374', '$300,000', '$150,000'], correct: 1 }
        ]
      }
    ]},
    { moduleId: 2, levelLabel: 'ระดับ 2', levelColor: 'amber', moduleTitle: 'อ่านงบการเงิน', lessons: [
      {
        id: '2-1', title: 'Revenue & Gross Profit', icon: 'coins',
        desc: 'Revenue & Gross Margin — วัด pricing power',
        tags: ['งบการเงิน', 'GOOGL'],
        sections: [
          { type: 'concept', heading: 'แนวคิด', body: '<p><strong>Revenue (รายได้)</strong> = เงินที่บริษัทได้รับจากขายสินค้า/บริการทั้งหมด<br><strong>Gross Profit</strong> = Revenue − Cost of Goods Sold (COGS)<br><strong>Gross Margin %</strong> = Gross Profit ÷ Revenue × 100</p><p>Gross Margin สูง = บริษัทมี pricing power และ cost structure ดี — เครื่องหมายของ moat</p>' },
          { type: 'example', heading: 'ตัวอย่าง — GOOGL FY2024', body: '<p><span class="ticker-tag">GOOGL</span> FY2024: Revenue ~$350B, Gross Profit ~$203B<br>→ Gross Margin ~<strong>58%</strong> — ทุก $100 ที่ขายได้ เหลือ $58 หลังจ่าย COGS</p><p>เปรียบเทียบ: ร้านสะดวกซื้อทั่วไป gross margin ~25%, Software companies มักอยู่ที่ 60–80%</p>' },
          { type: 'takeaway', heading: 'Key Takeaway', body: '<p>ดู <strong>Gross Margin trend</strong> ว่าเพิ่มขึ้นหรือลดลง — ถ้าลดทั้งที่ revenue โต อาจหมายถึงราคาสู้คู่แข่งไม่ได้หรือต้นทุนพุ่ง</p>' }
        ],
        quiz: [
          { q: 'Gross Profit คืออะไร?', options: ['กำไรสุทธิหลังภาษี', 'Revenue − Cost of Goods Sold', 'Revenue − ค่าใช้จ่ายทั้งหมด', 'เงินสดในมือ'], correct: 1 },
          { q: 'GOOGL gross margin ~58% แปลว่าอะไร?', options: ['บริษัทขาดทุน 58%', 'ทุก $100 รายได้ เหลือ $58 หลังจ่ายต้นทุนสินค้า', 'ภาษีอยู่ที่ 58%', 'ค่าใช้จ่ายคิดเป็น 58% ของรายได้'], correct: 1 },
          { q: 'Gross Margin ที่ดีบ่งบอกอะไร?', options: ['บริษัทมีหนี้น้อย', 'บริษัทมี pricing power และ cost structure แข็งแกร่ง', 'บริษัทจ่ายปันผลสูง', 'บริษัทมีพนักงานน้อย'], correct: 1 },
          { q: 'Gross Margin ของบริษัท Software โดยทั่วไปอยู่ที่ประมาณ?', options: ['10–20%', '30–40%', '60–80%', '90–100%'], correct: 2 }
        ]
      },
      {
        id: '2-2', title: 'Net Income & EPS', icon: 'calculator',
        desc: 'กำไรสุทธิต่อหุ้น ตัวเลขที่ตลาดจับตา',
        tags: ['งบการเงิน', 'NVDA'],
        sections: [
          { type: 'concept', heading: 'แนวคิด', body: '<p><strong>Net Income</strong> = กำไรสุทธิ = Revenue − COGS − Operating Expenses − Interest − Tax<br><strong>EPS (Earnings Per Share)</strong> = Net Income ÷ Shares Outstanding</p><p>EPS บอกว่าบริษัทสร้างกำไรต่อหุ้น 1 หน่วยได้เท่าไร — ตัวเลขที่ตลาดจับตามากที่สุด</p>' },
          { type: 'example', heading: 'ตัวอย่าง — NVDA EPS Growth', body: '<p><span class="ticker-tag">NVDA</span> EPS growth:<br>FY2023: EPS ~$1.74<br>FY2024: EPS ~$11.93 (+586% YoY!)<br>FY2025: EPS ~$2.99 (GAAP)</p><p>การที่ EPS พุ่งแรงทำให้ราคาหุ้น NVDA วิ่งแรงตาม — ตลาดซื้ออนาคต ไม่ใช่แค่ปัจจุบัน</p>' },
          { type: 'takeaway', heading: 'Key Takeaway', body: '<p>ดู <strong>EPS growth trend</strong> ว่าเติบโตสม่ำเสมอไหม ถ้า EPS ติดลบหรือหดตัว ต้องถามว่าเพราะอะไร — ลงทุน one-time หรือธุรกิจกำลังมีปัญหา</p>' }
        ],
        quiz: [
          { q: 'EPS ย่อมาจากอะไร?', options: ['Equity Per Share', 'Earnings Per Share', 'Exchange Price Score', 'Estimated Profit Score'], correct: 1 },
          { q: 'EPS คำนวณอย่างไร?', options: ['Revenue ÷ Shares', 'Net Income ÷ Shares Outstanding', 'Gross Profit ÷ Price', 'Debt ÷ Equity'], correct: 1 },
          { q: 'ถ้า EPS เพิ่มขึ้นทุกปีแต่ราคาหุ้นไม่ขึ้นเลย แปลว่าอะไร?', options: ['บริษัทแย่ลง', 'อาจเป็นสัญญาณว่าหุ้นถูกกว่าที่ควร (undervalued)', 'ตลาดมองว่า EPS ไม่สำคัญ', 'ไม่มีนัยสำคัญ'], correct: 1 },
          { q: 'NVDA EPS FY2024 เพิ่มจาก $1.74 เป็น $11.93 คิดเป็นกี่เปอร์เซ็นต์?', options: ['~100%', '~300%', '~586%', '~86%'], correct: 2 }
        ]
      },
      {
        id: '2-3', title: 'Free Cash Flow คืออะไร?', icon: 'currency-dollar',
        desc: 'เงินสดจริง ไม่ใช่กำไรบนกระดาษ',
        tags: ['งบการเงิน', 'AMZN'],
        sections: [
          { type: 'concept', heading: 'แนวคิด', body: '<p><strong>Free Cash Flow (FCF)</strong> = Operating Cash Flow − Capital Expenditure (CapEx)</p><p>FCF คือเงินสดจริงที่บริษัทสร้างได้ หลังจ่ายค่าลงทุนในโรงงาน/อุปกรณ์แล้ว<br>บริษัทมีกำไรบนบัญชีได้โดยไม่มีเงินสด — FCF จึงสำคัญกว่า Net Income บางครั้ง</p><ul><li>FCF สูง = บริษัทสร้างเงินจริง buyback/ปันผล/ลงทุนต่อได้โดยไม่พึ่งหนี้</li><li>FCF Yield = FCF ÷ Market Cap — เปรียบเหมือน "ดอกเบี้ย" ที่บริษัทให้คุณ</li></ul>' },
          { type: 'example', heading: 'ตัวอย่าง — AMZN FCF Turnaround', body: '<p><span class="ticker-tag">AMZN</span>:<br>FY2021: FCF = <strong>−$19B</strong> (ลงทุน fulfillment centers + AWS infrastructure มหาศาล)<br>FY2024: FCF = <strong>+$38B</strong> (AWS profitable, logistics ปันผลได้แล้ว)</p><p>FCF turnaround ครั้งนี้ไม่ใช่เรื่องบังเอิญ — เป็นผลจาก scale ที่ถึงจุดคุ้มทุน</p>' },
          { type: 'takeaway', heading: 'Key Takeaway', body: '<p>บริษัทที่ FCF เติบโตสม่ำเสมอ = engine ที่แข็งแกร่ง <strong>อย่าซื้อบริษัท FCF ติดลบเรื้อรัง</strong> ถ้าไม่รู้ว่าเมื่อไหร่จะ turn profitable</p>' }
        ],
        quiz: [
          { q: 'Free Cash Flow คำนวณอย่างไร?', options: ['Net Income − Tax', 'Operating Cash Flow − CapEx', 'Revenue − COGS', 'Gross Profit − Debt'], correct: 1 },
          { q: 'ทำไม FCF ถึงสำคัญกว่า Net Income ในบางกรณี?', options: ['เพราะ FCF รวม CapEx', 'เพราะ Net Income สามารถถูกบิดเบือนด้วยการบัญชี FCF คือเงินสดจริง', 'เพราะ FCF ไม่ต้องเสียภาษี', 'เพราะ Net Income ไม่เกี่ยวกับธุรกิจ'], correct: 1 },
          { q: 'AMZN FCF FY2021 ติดลบ −$19B เพราะอะไร?', options: ['ขาดทุนจากธุรกิจ', 'ลงทุนขยาย fulfillment centers + AWS อย่างหนัก', 'จ่ายภาษีสูงมาก', 'ผลจากโควิด'], correct: 1 },
          { q: 'FCF Yield บอกอะไร?', options: ['อัตราปันผล', 'ผลตอบแทนจากเงินสดที่บริษัทสร้างเทียบกับ market cap', 'อัตราการเติบโตของ revenue', 'P/E ratio'], correct: 1 }
        ]
      },
      {
        id: '2-4', title: 'Balance Sheet เบื้องต้น', icon: 'notebook',
        desc: 'Net Cash บอกความแข็งแกร่งทางการเงิน',
        tags: ['งบการเงิน', 'GOOGL'],
        sections: [
          { type: 'concept', heading: 'แนวคิด', body: '<p><strong>Balance Sheet</strong> แสดงฐานะการเงิน ณ จุดเวลาหนึ่ง:<br>Assets (สินทรัพย์) = Liabilities (หนี้สิน) + Equity (ส่วนของผู้ถือหุ้น)</p><ul><li><strong>Cash & Equivalents</strong> — เงินสดในมือ ความปลอดภัยในยามวิกฤต</li><li><strong>Total Debt</strong> — หนี้ระยะสั้น + ระยะยาว</li><li><strong>Net Cash</strong> = Cash − Total Debt (บวก = แข็งแกร่ง, ลบ = เสี่ยง)</li><li><strong>Debt/Equity Ratio</strong> — ยิ่งต่ำยิ่งปลอดภัย</li></ul>' },
          { type: 'example', heading: 'ตัวอย่าง — GOOGL vs ASML', body: '<p><span class="ticker-tag">GOOGL</span>: Cash ~$110B, Total Debt ~$10B → <strong>Net Cash +$100B</strong> — ปลอดภัยมาก ทำ buyback ได้ไม่จำกัด</p><p><span class="ticker-tag">ASML</span>: Debt สูงกว่า แต่ธุรกิจ monopoly EUV lithography ทำให้ tolerate ได้ — context สำคัญกว่าตัวเลขเดี่ยว</p>' },
          { type: 'takeaway', heading: 'Key Takeaway', body: '<p>บริษัท <strong>Net Cash เป็นบวก</strong> มี cushion รับมือวิกฤตได้ดีกว่า บริษัทที่มีหนี้สูงเสี่ยงมากหาก interest rate ขึ้น หรือ revenue หดตัว</p>' }
        ],
        quiz: [
          { q: 'Net Cash คำนวณอย่างไร?', options: ['Revenue − Debt', 'Cash & Equivalents − Total Debt', 'Assets − Liabilities', 'Net Income − CapEx'], correct: 1 },
          { q: 'บริษัทที่ Net Cash เป็นลบ แปลว่าอะไร?', options: ['บริษัทไม่มีรายได้', 'บริษัทมีหนี้มากกว่าเงินสดในมือ', 'บริษัทไม่จ่ายภาษี', 'บริษัทมีกำไรสูง'], correct: 1 },
          { q: 'GOOGL มี Net Cash ~$100B บอกอะไร?', options: ['GOOGL กำลังจะล้มละลาย', 'GOOGL มีความสามารถทำ buyback/ลงทุน/รับมือวิกฤตได้สูง', 'GOOGL ไม่ลงทุนอะไรเลย', 'ราคาหุ้น GOOGL จะขึ้น 100%'], correct: 1 }
        ]
      }
    ]},
    { moduleId: 3, levelLabel: 'ระดับ 3', levelColor: 'amber', moduleTitle: 'วิเคราะห์หุ้น', lessons: [
      {
        id: '3-1', title: 'P/E Ratio คืออะไร?', icon: 'magnifying-glass',
        desc: 'ตลาดยอมจ่ายกี่เท่าของกำไร? PEG ratio',
        tags: ['valuation', 'NVDA'],
        sections: [
          { type: 'concept', heading: 'แนวคิด', body: '<p><strong>P/E Ratio</strong> = Price ÷ EPS = ตลาดยอมจ่ายกี่เท่าของกำไรต่อปี</p><ul><li><strong>Forward P/E</strong> — ใช้ EPS คาดการณ์ปีหน้า (relevant กว่า trailing)</li><li><strong>PEG Ratio</strong> = P/E ÷ Growth Rate — P/E สูงอาจ OK ถ้า growth สูงกว่า</li><li>P/E สูง ≠ แพงเสมอไป ต้องดูการเติบโตและ quality ของกำไรด้วย</li></ul>' },
          { type: 'example', heading: 'ตัวอย่าง — NVDA vs VOO', body: '<p><span class="ticker-tag">NVDA</span> P/E ~50x: แพงกว่าตลาด แต่ EPS เติบโต 500%+ ในปีที่แล้ว<br><span class="ticker-tag">VOO</span> (S&P 500 avg) P/E ~22x: baseline ของตลาด</p><p>ถ้า NVDA โต 30%/ปี, P/E 50x → PEG = 50/30 = 1.67 — ยังอยู่ในเกณฑ์ reasonable สำหรับ AI infrastructure leader</p>' },
          { type: 'takeaway', heading: 'Key Takeaway', body: '<p>P/E เป็นจุดเริ่มต้น ไม่ใช่จุดสิ้นสุด ใช้ <strong>PEG + FCF + Moat</strong> ร่วมกัน ก่อนตัดสินว่าแพงหรือถูก</p>' }
        ],
        quiz: [
          { q: 'P/E Ratio คำนวณอย่างไร?', options: ['EPS ÷ Price', 'Price ÷ EPS', 'Revenue ÷ Net Income', 'Market Cap ÷ Revenue'], correct: 1 },
          { q: 'Forward P/E ต่างจาก Trailing P/E อย่างไร?', options: ['Forward ใช้กำไรย้อนหลัง Trailing ใช้กำไรคาดการณ์', 'Forward ใช้กำไรคาดการณ์ปีหน้า Trailing ใช้กำไรจริงปีที่แล้ว', 'ไม่ต่างกัน', 'Forward เฉพาะ ETF Trailing เฉพาะหุ้นทั่วไป'], correct: 1 },
          { q: 'PEG Ratio คืออะไร?', options: ['P/E ÷ Growth Rate', 'Price ÷ Earnings Growth', 'P/B ÷ Equity Growth', 'P/E × Market Cap'], correct: 0 },
          { q: 'NVDA P/E สูงกว่า VOO แต่ยังน่าลงทุนได้ เพราะ?', options: ['P/E สูง = แพงเสมอ', 'NVDA growth rate สูง ทำให้ PEG reasonable', 'VOO ไม่มี P/E', 'ราคา NVDA ต่ำกว่า VOO'], correct: 1 },
          { q: 'P/E ~22x ของ S&P 500 หมายถึงอะไร?', options: ['ตลาดยอมจ่าย 22 บาทต่อกำไร 100 บาท', 'ตลาดยอมจ่าย 22 เท่าของกำไรต่อปี', 'บริษัทโต 22% ต่อปี', 'หุ้นจะ drop 22%'], correct: 1 }
        ]
      },
      {
        id: '3-2', title: 'Moat คืออะไร — 7 Powers', icon: 'castle',
        desc: '7 Powers ที่ปกป้องธุรกิจจากคู่แข่ง',
        tags: ['moat', 'strategy'],
        sections: [
          { type: 'concept', heading: 'แนวคิด', body: '<p><strong>Economic Moat</strong> = ความได้เปรียบทางการแข่งขันที่ทนทาน — ปกป้อง margin และ revenue จากคู่แข่ง</p><p>Hamilton Helmer\'s <strong>7 Powers</strong>:<br>① Scale Economies &nbsp;② Network Effects &nbsp;③ Counter-Positioning &nbsp;④ Switching Costs<br>⑤ Branding &nbsp;⑥ Cornered Resource &nbsp;⑦ Process Power</p><p>บริษัทที่มีหลาย Power พร้อมกัน = moat หนาที่สุด</p>' },
          { type: 'example', heading: 'ตัวอย่าง — 7 Powers ในหุ้นจริง', body: '<p><span class="ticker-tag">GOOGL</span>: Network Effects (Search, YouTube, Maps ยิ่งมีคนใช้ยิ่งดี) + Scale Economies<br><span class="ticker-tag">NVDA</span>: Switching Costs (CUDA ecosystem — เปลี่ยน GPU ต้อง rewrite code ทั้งหมด) + Cornered Resource<br><span class="ticker-tag">ASML</span>: Counter-Positioning (monopoly EUV lithography ที่ไม่มีใครทำได้)</p>' },
          { type: 'takeaway', heading: 'Key Takeaway', body: '<p>ก่อนซื้อหุ้น ถามว่า <strong>"บริษัทนี้มี moat อะไร?"</strong> ถ้าตอบไม่ได้ อย่าซื้อ — ยิ่ง moat แข็งแกร่ง ยิ่ง hold ได้นาน</p>' }
        ],
        quiz: [
          { q: 'Economic Moat คืออะไร?', options: ['คูน้ำล้อมรอบโรงงาน', 'ความได้เปรียบทางการแข่งขันที่ทนทาน', 'อัตรากำไรขั้นต้น', 'จำนวนสิทธิบัตรของบริษัท'], correct: 1 },
          { q: 'NVDA ใช้ moat ประเภทไหนหลัก?', options: ['Network Effects', 'Switching Costs (CUDA ecosystem)', 'Branding', 'Scale Economies เท่านั้น'], correct: 1 },
          { q: 'Network Effect คืออะไร?', options: ['เครือข่าย internet ของบริษัท', 'ยิ่งมีคนใช้ product มาก ยิ่ง valuable มากขึ้น', 'จำนวน server ที่บริษัทมี', 'ความเร็ว internet'], correct: 1 },
          { q: 'ถ้าตอบไม่ได้ว่าบริษัทมี moat อะไร ควรทำอย่างไร?', options: ['ซื้อเลยเพราะ P/E ต่ำ', 'ไม่ซื้อจนกว่าจะเข้าใจ moat', 'ดูแค่ revenue growth', 'ถามนักวิเคราะห์อย่างเดียว'], correct: 1 }
        ]
      },
      {
        id: '3-3', title: 'Red Flags ที่ควรระวัง', icon: 'warning',
        desc: 'สัญญาณอันตรายที่ต้อง reconsider',
        tags: ['risk', 'checklist'],
        sections: [
          { type: 'concept', heading: 'แนวคิด', body: '<p>สัญญาณอันตรายที่ควร reconsider position:</p><ul><li><strong>Gross Margin หดตัวต่อเนื่อง</strong> — pricing power หายไป</li><li><strong>Revenue growth ชะลอ + Debt พุ่ง</strong> — กู้เงินมาพยุงยอดขาย</li><li><strong>FCF ติดลบเรื้อรัง</strong> โดยไม่มี path to profitability ชัดเจน</li><li><strong>Insider selling มหาศาล</strong> — คนในรู้อะไรที่เราไม่รู้</li><li><strong>Accounting changes บ่อย</strong> — อาจซ่อน loss</li></ul>' },
          { type: 'example', heading: 'ตัวอย่าง — SOFI', body: '<p><span class="ticker-tag">SOFI</span> เป็น risk position <em>น้อยมาก</em> เพราะ:<br>— ยังขาดทุน GAAP (แม้ adjusted profitable)<br>— Gross margin ต่ำกว่า fintech peer อื่น<br>— Revenue growth ดี แต่ยังไม่ชัดว่า moat จะสร้างได้จริงไหม<br>→ Risk position ไม่ใช่ core holding</p>' },
          { type: 'takeaway', heading: 'Key Takeaway', body: '<p>Red flag ไม่ได้แปลว่า "ขายทันที" แต่ต้องอธิบายได้ว่าทำไมถึงยังถือ — ถ้าอธิบายไม่ได้ ลด position ก่อน</p>' }
        ],
        quiz: [
          { q: 'Gross Margin หดตัวต่อเนื่องบ่งบอกอะไร?', options: ['บริษัทกำลังโตเร็ว', 'pricing power อาจหายไปหรือต้นทุนพุ่ง', 'สัญญาณซื้อเพิ่ม', 'P/E กำลังลด'], correct: 1 },
          { q: 'FCF ติดลบเรื้อรัง อันตรายเพราะอะไร?', options: ['ทำให้ EPS สูงเกินจริง', 'บริษัทอาจต้องกู้หรือออกหุ้นใหม่เพื่อยังชีพ', 'ทำให้ gross margin สูง', 'ไม่มีผลอะไรถ้า revenue โต'], correct: 1 },
          { q: 'Insider selling ปริมาณมากบอกอะไรได้?', options: ['หุ้นกำลังจะขึ้น', 'คนในบริษัทอาจรู้ข้อมูลเชิงลบที่ยังไม่เปิดเผย', 'บริษัทกำลัง buyback', 'ไม่มีนัยสำคัญ'], correct: 1 },
          { q: 'SOFI อยู่ใน portfolio แต่เป็น position เล็กเพราะ?', options: ['ราคาแพงเกินไป', 'margin ต่ำและ moat ยังไม่ชัดเจน', 'CEO ขาย insider stock', 'P/E สูงกว่า NVDA'], correct: 1 },
          { q: 'เจอ Red flag ควรทำอย่างไรก่อน?', options: ['ขายทุกอย่างทันที', 'อธิบายให้ได้ว่าทำไมถึงยังถือ ถ้าไม่ได้ ลด position', 'ซื้อเพิ่มเพราะราคาลง', 'ไม่ต้องทำอะไร'], correct: 1 }
        ]
      }
    ]},
    { moduleId: 4, levelLabel: 'ระดับ 4', levelColor: 'purple', moduleTitle: 'พอร์ต Case Study', lessons: [
      {
        id: '4-1', title: 'ทำไมถึงเลือก GOOGL, NVDA, AMZN?', icon: 'briefcase',
        desc: 'Thesis + kill condition สำหรับ 3 หุ้นหลัก',
        tags: ['portfolio', 'case study'],
        sections: [
          { type: 'concept', heading: 'Thesis Construction', body: '<p>การเลือกหุ้น core position ต้องตอบได้ 3 ข้อ:<br>① <strong>Moat</strong> — บริษัทมีความได้เปรียบที่ยั่งยืนอะไร?<br>② <strong>Revenue Durability</strong> — รายได้จะยังมาเรื่อยๆ แม้ macro เปลี่ยนหรือไม่?<br>③ <strong>Kill Condition</strong> — เมื่อไหร่ถึงจะขาย?</p>' },
          { type: 'example', heading: 'Thesis — 3 Core Positions', body: '<p><span class="ticker-tag">GOOGL</span>: Moat = Search monopoly + YouTube + Cloud. Kill condition = AI ทำให้ Search revenue ลดลง 20%+ YoY ต่อเนื่อง 2 quarters</p><p><span class="ticker-tag">NVDA</span>: Moat = CUDA ecosystem + H100/B100 supply monopoly. Kill condition = AMD/Intel ดึง enterprise customers ได้ &gt;20%</p><p><span class="ticker-tag">AMZN</span>: Moat = AWS (80% operating income) + logistics flywheel. Kill condition = AWS market share ลดลง QoQ ต่อเนื่อง หรือ FCF กลับไปติดลบ</p>' },
          { type: 'takeaway', heading: 'Key Takeaway', body: '<p><strong>ต้อง name kill condition ก่อนซื้อทุกครั้ง</strong> ถ้านึกไม่ออกว่าเมื่อไหร่ควรขาย แปลว่ายังไม่เข้าใจหุ้นพอ</p>' }
        ],
        quiz: [
          { q: 'Kill Condition คืออะไร?', options: ['ราคาหุ้นลงเกิน 10%', 'เงื่อนไขที่กำหนดไว้ล่วงหน้าว่าจะขายเมื่อ thesis พัง', 'เมื่อ P/E สูงกว่าตลาด', 'เมื่อ CEO ออก'], correct: 1 },
          { q: 'NVDA — Kill condition หลักคืออะไร?', options: ['ราคาลงเกิน 30%', 'AMD/Intel ดึง enterprise GPU market share ได้ >20%', 'NVDA ออก product ใหม่', 'Fed ขึ้น interest rate'], correct: 1 },
          { q: 'AMZN มีกำไร operating income จากส่วนไหนเป็นหลัก?', options: ['E-commerce', 'AWS (Amazon Web Services)', 'Advertising', 'Prime Video'], correct: 1 }
        ]
      },
      {
        id: '4-2', title: 'วางแผนสู่เป้าหมาย 1 ล้าน', icon: 'trophy',
        desc: 'เส้นทาง compound สู่เงินล้านก่อน 30',
        tags: ['planning', 'compound'],
        sections: [
          { type: 'concept', heading: 'Compound Growth Calculator', body: '<p>สูตร: <strong>FV = PV × (1+r)^n + PMT × [(1+r)^n − 1] / r</strong><br>PV = มูลค่าปัจจุบัน, r = return ต่อปี, n = จำนวนปี, PMT = ออมต่อปี</p><p>ตัวอย่าง scenario:<br>PV = ~100,000 บาท<br>PMT = 10,000 บาท/เดือน = 120,000 บาท/ปี<br>r = 10%/ปี (S&P 500 historical avg)<br>เป้า = 1,000,000 บาท</p>' },
          { type: 'example', heading: 'Projection — เส้นทางสู่ 1 ล้าน', body: '<p>ที่ r=10%:<br>ปีที่ 5: <strong>~660,000 บาท</strong><br>ปีที่ 6: <strong>~847,000 บาท</strong><br>ปีที่ 7: <strong>~1,052,000 บาท ✓</strong></p><p>ถ้า portfolio outperform (r=15%):<br>ปีที่ 5: <strong>~820,000 บาท</strong><br>ปีที่ 6: <strong>~1,063,000 บาท ✓</strong></p><p>เป้าหมาย <strong>1 ล้านภายใน 7 ปี</strong> → ทำได้ถ้าวินัยออม 10k/เดือน</p>' },
          { type: 'takeaway', heading: 'Key Takeaway', body: '<p>เงินล้านไม่ได้เกิดจาก "หุ้นปัง" วันเดียว แต่จาก <strong>ออมสม่ำเสมอ + ถือนาน + อย่าขายตอนตลาดร่วง</strong> — compound ทำงานให้เองในระยะยาว</p>' }
        ],
        quiz: [
          { q: 'ที่ r=10%/ปี เริ่ม PV=100k + ออม 10k/เดือน จะถึง 1 ล้านในปีที่เท่าไหร่?', options: ['ปีที่ 3', 'ปีที่ 5', 'ปีที่ 7', 'ปีที่ 10'], correct: 2 },
          { q: 'ถ้า portfolio outperform ที่ r=15% จะถึง 1 ล้านเร็วขึ้นอีกประมาณกี่ปี?', options: ['1 ปี', '2–3 ปี', '5 ปี', '10 ปี'], correct: 0 },
          { q: 'ปัจจัยที่สำคัญที่สุดในการถึงเป้า 1 ล้านคือ?', options: ['เลือกหุ้นให้ถูกทุกตัว', 'ออมสม่ำเสมอ + ถือนาน + ไม่ขายตอนตลาดร่วง', 'ลงทุนเฉพาะ crypto', 'ซื้อ-ขายถี่เพื่อจับ swing'], correct: 1 }
        ]
      }
    ]}
  ];

  function renderSchoolPage() {
    var p = schoolGetProgress();
    var totalLessons = SCHOOL_CURRICULUM.reduce(function(s, m) { return s + m.lessons.length; }, 0);
    var totalDone = p.completed.length;
    var pct = totalLessons > 0 ? Math.round(totalDone / totalLessons * 100) : 0;

    var pctEl = document.getElementById('school-overall-pct');
    if (pctEl) pctEl.textContent = pct + '%';
    var countEl = document.getElementById('school-lesson-count');
    if (countEl) countEl.textContent = totalDone + '/' + totalLessons + ' บทเรียน';

    var lastIdx = SCHOOL_CURRICULUM.length - 1;
    var prevIds = SCHOOL_CURRICULUM.slice(0, lastIdx).reduce(function(acc, m) {
      return acc.concat(m.lessons.map(function(l) { return l.id; }));
    }, []);
    var lastUnlocked = prevIds.every(function(id) { return p.completed.includes(id); });

    var container = document.getElementById('school-modules-container');
    if (!container) return;

    container.innerHTML = SCHOOL_CURRICULUM.map(function(mod, idx) {
      var isLocked = idx === lastIdx && !lastUnlocked;
      var modDone = mod.lessons.filter(function(l) { return p.completed.includes(l.id); }).length;
      var progText = modDone + '/' + mod.lessons.length;

      var divider = idx > 0 ? '<div class="school-level-divider"></div>' : '';

      var headerHtml = '<div class="school-module-header">' +
        '<span class="school-level-badge badge-' + mod.levelColor + '">' + mod.levelLabel + '</span>' +
        '<span class="school-module-title">' + mod.moduleTitle + '</span>' +
        (isLocked ? '<span class="school-module-lock">🔒 เรียนบทก่อนหน้าให้ครบก่อน</span>' : '') +
        '<span class="school-module-prog">' + progText + '</span>' +
        '</div>';

      var cardsHtml = '<div class="school-lessons-grid">' +
        mod.lessons.map(function(lesson) {
          var done = p.completed.includes(lesson.id);
          var score = p.quiz_scores[lesson.id];
          var scoreHtml = (score !== undefined) ? '<span class="school-card-score">' + score + '%</span>' : '';
          var badgeHtml = done ? '<span class="school-card-badge">✓</span>' : '';
          var descHtml = lesson.desc ? '<div class="school-card-desc">' + lesson.desc + '</div>' : '';
          var tagsHtml = (lesson.tags && lesson.tags.length) ? '<div class="school-card-tags">' +
            lesson.tags.map(function(t) { return '<span class="school-card-tag">' + t + '</span>'; }).join('') +
            '</div>' : '';
          var cls = 'school-card' + (isLocked ? ' school-card-locked' : '') + (done ? ' school-card-done' : '');
          return '<div class="' + cls + '"' + (isLocked ? '' : ' onclick="openLesson(\'' + lesson.id + '\')"') + '>' +
            '<div class="school-card-emoji"><i class="ph ph-' + lesson.icon + '"></i></div>' +
            '<div class="school-card-title">' + lesson.title + '</div>' +
            descHtml + tagsHtml + scoreHtml + badgeHtml + '</div>';
        }).join('') +
        '</div>';

      return divider + '<div class="school-module">' + headerHtml + cardsHtml + '</div>';
    }).join('');
  }

  var _currentLesson = null;
  var _quizAnswers = {};
  var _quizSubmitted = false;

  function openLesson(lessonId) {
    var lesson = null;
    for (var i = 0; i < SCHOOL_CURRICULUM.length; i++) {
      for (var j = 0; j < SCHOOL_CURRICULUM[i].lessons.length; j++) {
        if (SCHOOL_CURRICULUM[i].lessons[j].id === lessonId) { lesson = SCHOOL_CURRICULUM[i].lessons[j]; break; }
      }
      if (lesson) break;
    }
    if (!lesson) return;
    _currentLesson = lesson;
    _quizAnswers = {};
    _quizSubmitted = false;
    document.getElementById('school-lesson-content').innerHTML = buildLessonHTML(lesson);
    document.getElementById('school-grid-view').style.display = 'none';
    document.getElementById('school-lesson-view').style.display = 'block';
    window.scrollTo(0, 0);
  }

  function closeLessonModal() {
    document.getElementById('school-lesson-view').style.display = 'none';
    document.getElementById('school-grid-view').style.display = '';
    _currentLesson = null;
    renderSchoolPage();
  }

  function buildLessonHTML(lesson) {
    var p = schoolGetProgress();
    var done = p.completed.includes(lesson.id);
    var savedScore = p.quiz_scores[lesson.id];
    var sectionsHtml = lesson.sections.map(function(sec) {
      return '<div class="lesson-section lesson-sec-' + sec.type + '">' +
        '<div class="lesson-sec-label">' + sec.heading + '</div>' +
        '<div class="lesson-sec-body">' + sec.body + '</div></div>';
    }).join('');
    return '<div class="lesson-nav">' +
      '<button class="lesson-back-btn" onclick="closeLessonModal()">← กลับ</button>' +
      (done ? '<div class="lesson-complete-badge">🏆 เสร็จแล้ว</div>' : '') +
      '</div>' +
      '<div class="lesson-header">' +
      '<span class="lesson-emoji"><i class="ph ph-' + lesson.icon + '"></i></span>' +
      '<div><div class="lesson-id">Lesson ' + lesson.id + '</div>' +
      '<h2 class="lesson-title">' + lesson.title + '</h2></div>' +
      '</div>' +
      '<div class="lesson-sections">' + sectionsHtml + '</div>' +
      '<div class="lesson-quiz-wrap">' + buildQuizHTML(lesson.quiz, done, savedScore) + '</div>';
  }

  function buildQuizHTML(questions, alreadyDone, savedScore) {
    var headerHtml = '<div class="quiz-header"><span class="quiz-label">Quiz</span>' +
      (alreadyDone && savedScore !== undefined ? '<span class="quiz-score-badge">' + savedScore + '%</span>' : '') +
      '</div>';
    var questionsHtml = questions.map(function(q, qi) {
      return '<div class="quiz-question"><div class="quiz-q-text">' + (qi + 1) + '. ' + q.q + '</div>' +
        '<div class="quiz-options">' +
        q.options.map(function(opt, oi) {
          return '<div class="quiz-option" data-qi="' + qi + '" data-oi="' + oi + '" onclick="selectQuizOption(this,' + qi + ',' + oi + ')">' + opt + '</div>';
        }).join('') + '</div></div>';
    }).join('');
    var submitHtml = alreadyDone
      ? '<p class="quiz-already-done">คุณทำ Quiz นี้แล้ว — คะแนน ' + savedScore + '% &nbsp;ทำใหม่ได้เสมอ</p>' +
        '<button class="quiz-submit-btn" onclick="submitQuiz()">ส่ง Quiz</button>'
      : '<button class="quiz-submit-btn" onclick="submitQuiz()">ส่ง Quiz</button>';
    return headerHtml + '<div class="quiz-questions">' + questionsHtml + '</div>' + submitHtml;
  }

  function selectQuizOption(el, qi, oi) {
    if (_quizSubmitted) return;
    _quizAnswers[qi] = oi;
    var siblings = document.querySelectorAll('.quiz-option[data-qi="' + qi + '"]');
    siblings.forEach(function(s) { s.classList.remove('selected'); });
    el.classList.add('selected');
  }

  function submitQuiz() {
    if (!_currentLesson) return;
    var questions = _currentLesson.quiz;
    var correct = 0;
    questions.forEach(function(q, qi) {
      var chosen = _quizAnswers[qi];
      var opts = document.querySelectorAll('.quiz-option[data-qi="' + qi + '"]');
      if (chosen !== undefined) {
        if (chosen === q.correct) { correct++; if (opts[chosen]) opts[chosen].classList.add('correct'); }
        else { if (opts[chosen]) opts[chosen].classList.add('wrong'); if (opts[q.correct]) opts[q.correct].classList.add('correct'); }
      } else {
        if (opts[q.correct]) opts[q.correct].classList.add('correct');
      }
    });
    var score = Math.round(correct / questions.length * 100);
    _quizSubmitted = true;
    schoolMarkComplete(_currentLesson.id, score);
    var btn = document.querySelector('#school-lesson-content .quiz-submit-btn');
    if (btn) { btn.textContent = score === 100 ? 'Perfect! 🎉 ' + score + '%' : 'คะแนน: ' + score + '% — ลองใหม่ได้'; btn.onclick = retakeQuiz; }
    var header = document.querySelector('#school-lesson-content .quiz-header');
    if (header) {
      var existing = header.querySelector('.quiz-score-badge');
      if (existing) { existing.textContent = score + '%'; }
      else { var badge = document.createElement('span'); badge.className = 'quiz-score-badge'; badge.textContent = score + '%'; header.appendChild(badge); }
    }
  }

  function retakeQuiz() {
    _quizAnswers = {};
    _quizSubmitted = false;
    document.querySelectorAll('#school-lesson-content .quiz-option').forEach(function(el) {
      el.classList.remove('selected', 'correct', 'wrong');
    });
    var btn = document.querySelector('#school-lesson-content .quiz-submit-btn');
    if (btn) { btn.textContent = 'ส่ง Quiz'; btn.onclick = submitQuiz; }
  }

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
    if (pageId === 'school') renderSchoolPage();
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
      name: 'Godji', role: 'เจ้าของ', sub: 'เจ้าของ goddiary', img: 'Avatars/God-cool.png',
      tagline: 'เป้าหมาย: เงินล้านก่อน 30 · สุขภาพ · 3 ภาษา · YouTube',
      personality: 'คนที่สร้างระบบนี้ขึ้นเพื่อดูแลทุกมิติของชีวิต ชอบ systems thinking และ long-term mindset ไม่ชอบปล่อยให้อะไรหลุดจากการควบคุม',
      duties: ['ตั้งเป้าหมายชีวิตและ OKR รายปี', 'สั่งการทีมและตัดสินใจขั้นสุดท้าย', 'ลงทุนระยะยาว (US stocks)', 'สร้างระบบ goddiary เพื่อจัดการทุกมิติ']
    },
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
    { id: 'godji', name: 'Godji', img: 'Avatars/God.png', fb: '', isMe: true, googleUid: '' },
    { id: 'tac',  name: 'Tac',  img: 'Avatars/Friends/Tac.png',  fb: '', googleUid: '' },
    { id: 'tong', name: 'Tong',  img: 'Avatars/Friends/Tong.png', fb: 'https://web.facebook.com/sukunya.meekhun.2025', googleUid: '' },
    { id: 'peet', name: 'Peet',  img: 'Avatars/Friends/Peet.png', fb: 'https://web.facebook.com/peerawat.uton', googleUid: '' },
    { id: 'boat', name: 'Boat', img: 'Avatars/Friends/Boat.png', fb: 'https://web.facebook.com/thawatchai.sap', googleUid: '' }
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
    var all = _db.getFriendsAll();
    return '<div class="companion-stack">' +
      ids.map(function(cid) {
        var f = all.find(function(x) { return x.id === cid; });
        if (!f) return '';
        if (f.img) return '<img class="comp-avatar" src="' + f.img + '" alt="' + f.name + '" title="' + f.name + '">';
        var initials = f.name.charAt(0).toUpperCase();
        return '<span class="comp-avatar comp-avatar-initials" title="' + f.name + '">' + initials + '</span>';
      }).join('') +
    '</div>';
  }

  function buildTripCard(trip) {
    var companions = _db.getTripCompanions(trip.id);
    var bottom = companions.length
      ? '<div class="trip-card-bottom">' + buildCompanionStack(companions) + '<span class="trip-duration-text">' + trip.duration + '</span></div>'
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

    var companions = _db.getTripCompanions(trip.id);
    var allFriends = _db.getFriendsAll();
    var companionsRowHTML = '<div class="trip-companions-row">';
    if (companions.length) {
      companionsRowHTML += companions.map(function(cid) {
        var f = allFriends.find(function(x) { return x.id === cid; });
        if (!f) return '';
        var avatarHTML = f.img
          ? '<img class="tcr-avatar" src="' + f.img + '" alt="' + f.name + '">'
          : '<span class="tcr-avatar comp-avatar-initials">' + f.name.charAt(0).toUpperCase() + '</span>';
        return '<div class="tcr-item">' + avatarHTML + '<span class="tcr-name">' + f.name + '</span></div>';
      }).join('');
    }
    companionsRowHTML += '<button class="tcr-edit-btn" onclick="openCompanionsModal(\'' + trip.id + '\')">' + (companions.length ? '✎ แก้ไข' : '+ เพิ่มคน') + '</button></div>';

    var jumpChips = trip.days.map(function(day, idx) {
      return '<span class="trip-jump-chip" onclick="jumpToSection(\'trip-sec-' + idx + '\')">' + day.label + '</span>';
    });
    if (calendarHTML) jumpChips.push('<span class="trip-jump-chip" onclick="jumpToSection(\'trip-sec-calendar\')">ปฏิทิน</span>');
    if (todosHTML) jumpChips.push('<span class="trip-jump-chip" onclick="jumpToSection(\'trip-sec-todos\')">To-do</span>');
    if (budgetHTML) jumpChips.push('<span class="trip-jump-chip" onclick="jumpToSection(\'trip-sec-budget\')">Budget</span>');
    if (notesHTML) jumpChips.push('<span class="trip-jump-chip" onclick="jumpToSection(\'trip-sec-notes\')">หมายเหตุ</span>');
    jumpChips.push('<span class="trip-jump-chip" onclick="jumpToSection(\'trip-sec-comments\')">ความคิดเห็น</span>');
    var jumpNavHTML = '<div class="trip-jump-nav">' + jumpChips.join('') + '</div>';

    var commentsHTML = (
      '<div class="trip-comments" id="trip-sec-comments">' +
        '<div class="trip-sec-title">ความคิดเห็น</div>' +
        '<div id="comments-list-' + trip.id + '" class="comments-list"></div>' +
        '<form class="comment-form" onsubmit="submitComment(event,\'' + trip.id + '\')">' +
          '<textarea class="comment-input" name="text" placeholder="เขียนความคิดเห็น..." rows="2" required></textarea>' +
          '<button class="comment-submit" type="submit">ส่ง</button>' +
        '</form>' +
      '</div>'
    );

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
        '<div class="trip-detail-main"><div class="days-list">' + daysHTML + '</div>' + commentsHTML + '</div>' +
        '<div class="trip-detail-aside" id="trip-sec-aside">' + calendarHTML + todosHTML + budgetHTML + notesHTML + '</div>' +
      '</div>'
    );
  }

  var _commentUnsubscribe = null;
  function renderComments(tripId) {
    if (_commentUnsubscribe) { _commentUnsubscribe(); _commentUnsubscribe = null; }
    _commentUnsubscribe = _db.getComments(tripId, function(items) {
      var el = document.getElementById('comments-list-' + tripId);
      if (!el) return;
      if (!items.length) {
        el.innerHTML = '<div class="comments-empty">ยังไม่มีความคิดเห็น — เป็นคนแรกที่แสดงความคิดเห็นค่ะ</div>';
        return;
      }
      el.innerHTML = items.map(function(c) {
        var avatarHTML = c.avatar
          ? '<img class="comment-avatar" src="' + c.avatar + '" referrerpolicy="no-referrer">'
          : '<div class="comment-avatar comment-avatar-init">' + (c.name || '?').charAt(0).toUpperCase() + '</div>';
        var tsLabel = c.ts ? new Date(c.ts.seconds * 1000).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '';
        var isOwn = _currentUser && _currentUser.uid === c.uid;
        return (
          '<div class="comment-item">' +
            avatarHTML +
            '<div class="comment-body">' +
              '<div class="comment-meta"><span class="comment-name">' + c.name + '</span><span class="comment-ts">' + tsLabel + '</span>' +
                (isOwn ? '<button class="comment-delete" onclick="deleteComment(\'' + tripId + '\',\'' + c._id + '\')">ลบ</button>' : '') +
              '</div>' +
              '<div class="comment-text">' + c.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') + '</div>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    });
  }

  function openProfileEdit() {
    if (!_currentUser || !_isAllowed) return;
    _db.profileRef(_currentUser.uid).get().then(function(snap) {
      var p = snap.exists ? snap.data() : {};
      document.getElementById('profile-edit-name').value = p.name || _currentUser.displayName || '';
      document.getElementById('profile-edit-bio').value  = p.bio  || '';
      document.getElementById('profile-edit-img').value  = '';
      var currentImg = p.img && !p.img.includes('googleusercontent.com') ? p.img : '';
      var preview = document.getElementById('profile-edit-img-preview');
      var init    = document.getElementById('profile-edit-img-init');
      if (currentImg) {
        preview.src = currentImg; preview.style.display = 'block'; init.style.display = 'none';
      } else {
        preview.style.display = 'none'; init.style.display = 'flex';
        init.textContent = (_currentUser.displayName || _currentUser.email || 'G')[0].toUpperCase();
      }
      openAuthModal('profile-edit-modal');
    });
  }

  function previewProfileImg(input) {
    if (!input.files || !input.files[0]) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      var preview = document.getElementById('profile-edit-img-preview');
      var init    = document.getElementById('profile-edit-img-init');
      preview.src = e.target.result; preview.style.display = 'block'; init.style.display = 'none';
    };
    reader.readAsDataURL(input.files[0]);
  }

  function resizeToBase64(file, size, quality) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function(e) {
        var img = new Image();
        img.onload = function() {
          var canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          var ctx = canvas.getContext('2d');
          var s = Math.min(img.width, img.height);
          var ox = (img.width - s) / 2, oy = (img.height - s) / 2;
          ctx.drawImage(img, ox, oy, s, s, 0, 0, size, size);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function saveProfileEdit(e) {
    e.preventDefault();
    if (!_currentUser || !_isAllowed) return;
    var name      = document.getElementById('profile-edit-name').value.trim();
    var bio       = document.getElementById('profile-edit-bio').value.trim();
    var fileInput = document.getElementById('profile-edit-img');
    var file      = fileInput.files && fileInput.files[0];
    var update    = { name: name, bio: bio };
    if (file) {
      update.img = await resizeToBase64(file, 256, 0.82);
    }
    _db.saveProfile(_currentUser.uid, update).then(function() {
      closeAuthModal('profile-edit-modal');
      renderPeople();
    });
  }

  function submitComment(e, tripId) {
    e.preventDefault();
    if (!_currentUser) { alert('กรุณา Sign in ก่อนแสดงความคิดเห็นค่ะ'); return; }
    var form = e.target;
    var text = form.text.value.trim();
    if (!text) return;
    _db.addComment(tripId, text).then(function() { form.reset(); }).catch(function(err) { console.warn('addComment:', err); });
  }

  function deleteComment(tripId, commentId) {
    _db.deleteComment(tripId, commentId).catch(function(err) { console.warn('deleteComment:', err); });
  }

  function openTrip(id, skipHistory) {
    var trip = tripsData.find(function(t) { return t.id === id; });
    if (!trip) return;
    document.getElementById('trip-detail-body').innerHTML = buildTripDetail(trip);
    document.getElementById('trips-list').style.display = 'none';
    document.getElementById('trips-detail').style.display = 'block';
    document.querySelector('.main').scrollTop = 0;
    if (!skipHistory) history.pushState(null, '', '#trips/' + id);
    renderComments(id);
  }

  function closeTrip() {
    if (_commentUnsubscribe) { _commentUnsubscribe(); _commentUnsubscribe = null; }
    document.getElementById('trips-detail').style.display = 'none';
    document.getElementById('trips-list').style.display = 'block';
    history.pushState(null, '', '#trips');
  }

  function openCompanionsModal(tripId) {
    var currentIds = _db.getTripCompanions(tripId);
    var modal = document.getElementById('companions-modal');
    modal.dataset.tripId = tripId;
    renderCompanionChecklist(currentIds);
    openAuthModal('companions-modal');
  }

  function renderCompanionChecklist(currentIds) {
    var list = document.getElementById('companions-checklist');
    var all = _db.getFriendsAll();
    list.innerHTML = all.map(function(f) {
      var checked = currentIds.indexOf(f.id) !== -1 ? 'checked' : '';
      var avatar = f.img
        ? '<img class="comp-check-avatar" src="' + f.img + '" alt="' + f.name + '">'
        : '<span class="comp-check-avatar comp-avatar-initials">' + f.name.charAt(0).toUpperCase() + '</span>';
      return '<label class="comp-check-item">' +
        '<input type="checkbox" value="' + f.id + '" ' + checked + '>' +
        avatar +
        '<span class="comp-check-name">' + f.name + '</span>' +
      '</label>';
    }).join('');
  }

  function addNewCompanion() {
    var input = document.getElementById('new-companion-input');
    var name = (input.value || '').trim();
    if (!name) return;
    var f = _db.addFriend(name);
    input.value = '';
    var modal = document.getElementById('companions-modal');
    var currentIds = _db.getTripCompanions(modal.dataset.tripId);
    currentIds.push(f.id);
    renderCompanionChecklist(currentIds);
  }

  function saveCompanions() {
    var modal = document.getElementById('companions-modal');
    var tripId = modal.dataset.tripId;
    var boxes = modal.querySelectorAll('input[type=checkbox]:checked');
    var ids = Array.prototype.map.call(boxes, function(c) { return c.value; });
    _db.setTripCompanions(tripId, ids);
    closeAuthModal('companions-modal');
    buildTripCards();
    var trip = tripsData.find(function(t) { return t.id === tripId; });
    if (trip && document.getElementById('trips-detail').style.display !== 'none') {
      document.getElementById('trip-detail-body').innerHTML = buildTripDetail(trip);
    }
    renderPeople();
  }

  function buildTripCards() {
    var vGrid = document.getElementById('visited-trips-grid');
    var pGrid = document.getElementById('planning-trips-grid');
    if (!vGrid || !pGrid) return;
    vGrid.innerHTML = '';
    pGrid.innerHTML = '';
    tripsData.forEach(function(trip) {
      var html = buildTripCard(trip);
      if (trip.status === 'visited') vGrid.innerHTML += html;
      else pGrid.innerHTML += html;
    });
  }
  buildTripCards();

  function buildPersonCard(f, isSelf) {
    var allTrips = tripsData.filter(function(t) {
      return _db.getTripCompanions(t.id).indexOf(f.id) !== -1;
    });
    var visitedTrips  = allTrips.filter(function(t) { return t.status === 'visited'; });
    var planningTrips = allTrips.filter(function(t) { return t.status !== 'visited'; });

    var tripsHTML = '';
    if (visitedTrips.length) {
      tripsHTML += '<div class="person-trips-group"><div class="person-trips-label">ไปแล้ว</div>' +
        '<div class="person-trips">' + visitedTrips.map(function(t) {
          return '<span class="person-trip-tag visited">' + t.name + '</span>';
        }).join('') + '</div></div>';
    }
    if (planningTrips.length) {
      tripsHTML += '<div class="person-trips-group"><div class="person-trips-label planning">กำลังวางแผน</div>' +
        '<div class="person-trips">' + planningTrips.map(function(t) {
          return '<span class="person-trip-tag planning">' + t.name + '</span>';
        }).join('') + '</div></div>';
    }
    if (!tripsHTML) {
      tripsHTML = '<span style="font-size:0.8rem;color:var(--muted)">ยังไม่มีทริปที่บันทึกไว้</span>';
    }

    var roleTag  = f.isMe ? 'เจ้าของ' : 'ซิโบเล็ต ซิโบติ้ว';
    var subText  = f.isMe ? 'เจ้าของ goddiary'
      : allTrips.length
        ? (visitedTrips.length ? visitedTrips.length + ' ทริปไปแล้ว' : '') +
          (visitedTrips.length && planningTrips.length ? ' · ' : '') +
          (planningTrips.length ? planningTrips.length + ' แผน' : '')
        : 'ซิโบเล็ต ซิโบติ้ว';

    var bioHTML = f.bio ? '<p style="font-size:0.78rem;color:var(--muted);margin:0.25rem 0 0.75rem">' + f.bio + '</p>' : '';
    var editBtn = isSelf && _isAllowed
      ? '<button class="profile-edit-btn" onclick="event.stopPropagation();openProfileEdit()">✎ แก้ไขโปรไฟล์</button>'
      : '';

    var imgHTML = f.img
      ? '<img class="f-photo" src="' + f.img + '" alt="' + f.name + '" referrerpolicy="no-referrer">'
      : '<div class="f-photo f-photo-init">' + (f.name || '?').charAt(0).toUpperCase() + '</div>';

    return (
      '<div class="flip-wrapper" onclick="toggleFlip(this)">' +
        '<div class="flip-inner">' +
          '<div class="flip-front">' +
            imgHTML +
            '<div class="f-overlay">' +
              (f.isMe ? '<span class="f-me-badge">เจ้าของ</span>' : '') +
              (isSelf && !f.isMe ? '<span class="f-me-badge" style="background:var(--green-mid)">ฉัน</span>' : '') +
              '<span class="fname">' + f.name + '</span>' +
              '<span class="f-sub">' + subText + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="flip-back">' +
            '<div class="back-top">' +
              '<span class="back-role-tag">' + roleTag + '</span>' +
              '<span class="back-flip-hint">← กลับ</span>' +
            '</div>' +
            '<span style="font-family:Caveat,cursive;font-size:1.6rem;font-weight:600;color:var(--green-dark);display:block;margin-bottom:0.25rem">' + f.name + '</span>' +
            bioHTML +
            editBtn +
            tripsHTML +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  async function renderPeople() {
    var grid = document.getElementById('people-grid');
    var countEl = document.getElementById('people-count');
    if (!grid) return;

    var profiles = await _db.getProfiles();
    var merged = friendsData.map(function(f) { return Object.assign({}, f); });

    // merge Firestore profiles เข้า friendsData
    profiles.forEach(function(p) {
      var linked = p.linkedFriendId ? merged.find(function(f) { return f.id === p.linkedFriendId; }) : null;
      if (linked) {
        if (p.img && !p.img.includes('googleusercontent.com')) linked.img = p.img;
        if (p.bio) linked.bio = p.bio;
        linked._uid = p.uid;
      } else {
        // ยังไม่ได้ link → เพิ่มการ์ดใหม่เฉพาะถ้าไม่ซ้ำ
        var exists = merged.find(function(f) { return f._uid === p.uid; });
        if (!exists) {
          merged.push({ id: 'user_' + p.uid, name: p.name, img: p.img, bio: p.bio, fb: '', _uid: p.uid });
        }
      }
    });

    if (countEl) countEl.textContent = merged.length + ' คน';
    grid.innerHTML = merged.map(function(f) {
      var isSelf = _currentUser && (f._uid === _currentUser.uid || (f.googleUid && f.googleUid === _currentUser.uid));
      return buildPersonCard(f, isSelf);
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
        <div class="proj-card-head" onclick="toggleProjCard(this)">
          <span class="proj-card-name">${proj.name}</span>
          <div class="proj-head-right">
            <span class="proj-card-action" onclick="event.stopPropagation();deleteProj(${pi})">ลบ</span>
            <span class="proj-chevron">▾</span>
          </div>
        </div>
        ${proj.desc ? `<p class="proj-card-desc">${proj.desc}</p>` : ''}
        <div class="proj-card-progress">
          <div class="proj-progress-bar"><div class="proj-progress-fill" style="width:${pct}%"></div></div>
          <span class="proj-progress-pct">${pct}%</span>
        </div>

        <div class="proj-body">
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
  function toggleProjCard(headEl) {
    headEl.closest('.proj-card').classList.toggle('collapsed');
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
    renderSchoolPage();

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
      buildTripCards();
      renderPeople();
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